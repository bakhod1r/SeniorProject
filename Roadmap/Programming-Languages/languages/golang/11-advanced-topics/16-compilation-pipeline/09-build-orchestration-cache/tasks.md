# Build Orchestration & Cache — Tasks

Hands-on exercises. Use a throwaway module so you can clean the cache freely:

```sh
mkdir cache-lab && cd cache-lab
go mod init example.com/cachelab
cat > main.go <<'EOF'
package main

import (
	"fmt"
	"example.com/cachelab/greet"
)

func main() { fmt.Println(greet.Hello("world")) }
EOF
mkdir greet
cat > greet/greet.go <<'EOF'
package greet

func Hello(name string) string { return "hello, " + name }
EOF
go build ./...
```

---

## Task 1 — Read every tool call from `-x`

Run `go build -a -x . 2>&1 | less`. Identify, in order: the `WORK=` line, a
`compile` call for `greet`, a `compile` call for `main`, and the final `link`.
Note the `-importcfg` argument on each — what does that file do?

## Task 2 — Keep and explore `$WORK`

```sh
go build -a -work .
ls "$WORK_DIR"/b001/   # use the path printed by -work
```

Find `_pkg_.a`, `importcfg`, and `importcfg.link`. Open `importcfg` — confirm it
maps import paths to compiled `.a` files. Which `bNNN` dir holds `greet`?

## Task 3 — Measure cold vs warm

```sh
go clean -cache && time go build ./...    # cold
time go build ./...                        # warm
```

Record both times. Why is the second nearly instant? Roughly how much of the
cold time is the standard library?

## Task 4 — Dump and read the action graph

```sh
go build -debug-actiongraph=ag.json -a .
```

Open `ag.json`. List the distinct `Mode` values you see. Find the node whose
`Package` is `"example.com/cachelab"` with `Mode:"link"` — what's in its `Deps`?
Find a `build` node and a `link` node and compare `TimeStart`/`TimeDone`.

## Task 5 — Bust the cache with a one-byte source change

Change `"hello, "` to `"hi, "` in `greet/greet.go`, then:

```sh
go build -x . 2>&1 | grep -c compile
```

How many packages recompiled, and why exactly those (think action-ID
propagation up the DAG)? Revert and rebuild — instant again?

## Task 6 — Watch the cache key being computed

```sh
GODEBUG=gocachehash=1 go build greet 2>&1 | head -20
```

Identify lines showing the compiler version, the source file, and the flags
being mixed into the key. Add `-trimpath` and rerun — does the hash change?

## Task 7 — Prove `-gcflags` scoping

```sh
go build -gcflags='-m' ./...           # note which packages report inlining
go build -gcflags='all=-m' ./... 2>&1 | grep -c 'inlining'
```

Compare the output sizes. Explain why `all=` reports far more (it includes the
std lib and deps).

## Task 8 — Cache a `go test` result

```sh
cat > greet/greet_test.go <<'EOF'
package greet
import "testing"
func TestHello(t *testing.T){ if Hello("x")=="" { t.Fatal("empty") } }
EOF
go test ./greet     # runs
go test ./greet     # (cached)
```

Confirm the second prints `(cached)`. Then force a real run with
`go test -count=1 ./greet`. What changed in the key to make `-count=1` re-run?

## Task 9 — Invalidate the test cache two ways

Make the test cache miss by (a) editing `greet.go`, then (b) running
`go clean -testcache`. For each, run `go test ./greet` and confirm it actually
executed. Bonus: trace decisions with `GODEBUG=gocachetest=1 go test ./greet`.

## Task 10 — Share one GOCACHE between two project dirs

```sh
export GOCACHE=$(mktemp -d)
cp -r ../cache-lab ../cache-lab2
go build ./...                     # populates the shared cache
cd ../cache-lab2 && time go build ./...   # should hit the shared cache → fast
```

Why does the second project build fast despite never being built before? (Hint:
identical source + same `GOCACHE` = same action IDs.) Try it with and without
`-trimpath` if the two dirs have different absolute paths.

## Task 11 — Force a full rebuild and feel the cost

```sh
time go build ./...        # warm
time go build -a ./...     # rebuilds everything incl. std lib
```

Compare. Explain why `-a` in CI is an anti-pattern.

## Task 12 — Tune parallelism

```sh
go clean -cache && time go build -p 1 ./...    # serial
go clean -cache && time go build -p "$(nproc 2>/dev/null || sysctl -n hw.ncpu)" ./...
```

Where does extra parallelism help, and where doesn't it (think about the single
`link` action)?

## Task 13 — Reproducible build check

```sh
go build -trimpath -ldflags='-buildid=' -o app1 ./
go clean -cache
go build -trimpath -ldflags='-buildid=' -o app2 ./
shasum app1 app2     # should match
```

Now drop `-trimpath` from one build (in a dir with a different absolute path) and
observe the hashes diverge. What input changed?

## Task 14 — Find the slowest action

```sh
go build -debug-actiongraph=ag.json -a ./...
```

Using `jq` (or a short script), compute `TimeDone - TimeStart` per node and
print the five slowest. Is the bottleneck a `compile` or the final `link`? How
would you attack it?

---

When done, clean up: `go clean -cache` (optional) and `rm -rf cache-lab
cache-lab2`. You've now driven every observability and cache knob the `go`
command exposes.
