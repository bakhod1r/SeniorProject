# pprof Deep Dive — Tasks

Practical exercises. Do them in order. Each task is small enough for one focused session and produces an artifact (a profile file, a screenshot, a commit) you can compare with the answer.

---

## Task 1: Your first profile

Write a tiny Go program with one CPU-heavy function (e.g., a slow Fibonacci, or `sha256` of a long byte slice in a loop). Capture a 10-second CPU profile two ways:

1. Via `runtime/pprof` to a file.
2. Via `net/http/pprof` over HTTP.

Open both with `go tool pprof -http=:`. Confirm they look identical.

**Goal.** Internalize the two collection paths.

---

## Task 2: Reading flat vs. cum

Take Task 1's profile. Identify in the `top` output:

- One function with high `flat` and low `cum` (a leaf).
- One function with low `flat` and high `cum` (a wrapper or dispatcher).
- One function where `flat ≈ cum` (does its own work, no callees).

Write one sentence per function explaining what role it plays in your program.

**Goal.** Build correct intuition about the two columns.

---

## Task 3: List with line granularity

Pick the hottest function from Task 1. Run:

```
(pprof) granularity=lines
(pprof) list <fn>
```

Identify the single hottest line. Optimize it (rewrite the expression, pre-size a slice, avoid an allocation). Re-profile. Use `-base=old.pb.gz new.pb.gz` to confirm the line is now cheaper.

**Goal.** Connect a profile observation to a code change to a measurable diff.

---

## Task 4: Heap profile in four views

Write a program that allocates a mix of short-lived and long-lived objects (e.g., a service that parses requests into structs, keeping a recent-history cache of 100 of them). Run for 60 seconds, then collect a heap profile.

Open with `-http=:` and switch through all four sample indices:

- `inuse_space`
- `inuse_objects`
- `alloc_space`
- `alloc_objects`

For each, write down the top function and one sentence explaining why it dominates that view.

**Goal.** See firsthand how the four views answer different questions.

---

## Task 5: Diff a real optimization

Take an open-source Go project (anything: `go-redis`, `chi`, your own). Identify a function and write a benchmark that exercises it heavily. Capture a CPU profile.

Apply one optimization (pre-size a slice, use `sync.Pool`, replace `interface{}` with a typed parameter). Re-capture.

```
go tool pprof -http=: -base=before.pb.gz after.pb.gz
```

Save a screenshot of the diff flame graph. Write a one-paragraph summary of the change.

**Goal.** Practice the optimize-measure-confirm loop with realistic code.

---

## Task 6: Goroutine leak detection

Write a program that intentionally leaks goroutines (e.g., a worker pool whose `done` channel is never closed). Run it. Watch `runtime.NumGoroutine()` grow.

Capture both forms of the goroutine profile:

```
curl -o gr.pb.gz   "http://localhost:6060/debug/pprof/goroutine"
curl -o gr2.txt    "http://localhost:6060/debug/pprof/goroutine?debug=2"
```

Open the binary form in pprof; identify the leaking stack. Then open the text form and find the same stack. Note the line where the goroutine is parked.

**Goal.** Practice both diagnostic forms; understand when text is faster.

---

## Task 7: Enable block and mutex profiling

Write a program with two goroutines contending on a `sync.Mutex` around a non-trivial critical section. Try to profile without enabling block/mutex first — confirm the profiles are empty.

Add:

```go
runtime.SetBlockProfileRate(1)
runtime.SetMutexProfileFraction(1)
```

Re-profile. Confirm both `/block` and `/mutex` now contain useful data. Run `peek` on the wait functions to find the contended mutex.

**Goal.** Internalize that block and mutex profiling are opt-in.

---

## Task 8: Custom profile

Implement a custom profile for "currently held resources" in a small program — for example, open file handles or in-flight HTTP requests:

```go
var inflight = pprof.NewProfile("inflight")

func handle(w http.ResponseWriter, r *http.Request) {
    inflight.Add(r, 2)
    defer inflight.Remove(r)
    realWork(w, r)
}
```

Expose at `/debug/pprof/inflight` (custom handler). Hit the endpoint while requests are running. Open with pprof and see the call stacks of in-flight requests.

**Goal.** See how easy it is to extend the framework.

---

## Task 9: Profile labels

Take a small HTTP server (Task 8's, or anything). Add middleware that wraps each handler with:

```go
ctx := pprof.WithLabels(r.Context(), pprof.Labels("route", routePattern))
pprof.Do(ctx, pprof.Labels(), func(ctx context.Context) {
    handler(w, r.WithContext(ctx))
})
```

Drive 60 s of mixed traffic against two routes. Capture a CPU profile. In the shell:

```
(pprof) tagfocus=route=/api/a
(pprof) top
(pprof) tagfocus=route=/api/b
(pprof) top
```

Compare. Confirm the slices look different.

**Goal.** Use labels to slice a profile.

---

## Task 10: Label propagation across goroutines

Modify Task 9's handler so it spawns a worker via `go func(){ ... }()` that does most of the work. Re-profile and re-apply the same `tagfocus`. Notice that most cost is now unlabeled.

Fix by either:

- Wrapping the goroutine body in `pprof.Do(ctx, labels, ...)`.
- Calling `pprof.SetGoroutineLabels(ctx)` inside the goroutine.

Re-profile and confirm the `tagfocus` view is correct again.

**Goal.** Live the gotcha; remember it.

---

## Task 11: Combine profiles from a "fleet"

Run the same program in three terminal sessions (or three processes on different ports). Hit them with traffic. Capture a 30 s CPU profile from each:

```
go tool pprof -seconds=30 -output=p1.pb.gz http://localhost:6061/debug/pprof/profile
go tool pprof -seconds=30 -output=p2.pb.gz http://localhost:6062/debug/pprof/profile
go tool pprof -seconds=30 -output=p3.pb.gz http://localhost:6063/debug/pprof/profile
```

Open the union:

```
go tool pprof -http=: p1.pb.gz p2.pb.gz p3.pb.gz
```

Compare with a single 30 s profile. The union has ~3× the samples — the flame graph should look smoother.

**Goal.** Practice fleet aggregation.

---

## Task 12: Read the raw protobuf

```
go tool pprof -raw cpu.pb.gz | less
go tool pprof -proto cpu.pb.gz > cpu.proto.txt
```

Skim the output. Find:

- The `sample_type` lines.
- One `sample` entry with its values and stack.
- The function table.

Write a one-paragraph description of how the pieces fit together. (Read `specification.md` §9 if stuck.)

**Goal.** Demystify the format. Once you've seen it, every pprof feature makes more sense.

---

## Task 13: Production-safe endpoint

In a small service, set up the pprof endpoint correctly:

- Bind to `127.0.0.1:6060` only.
- Use a dedicated mux (don't pollute `http.DefaultServeMux`).
- Set bounded block and mutex profile rates.
- Confirm with `curl http://localhost:6060/debug/pprof/` that the index page loads from localhost but not from `0.0.0.0:6060`.

Write a one-paragraph rationale for each choice as if explaining it in code review.

**Goal.** Cement the production posture.

---

## Bonus task: continuous profiling at home

Spin up Pyroscope locally (Docker image), point your toy service at it, generate load for 30 minutes. Open the Pyroscope UI; compare the two timestamps half an hour apart. Use the built-in diff view.

```
docker run -d -p 4040:4040 grafana/pyroscope
```

Then in your service:

```go
import "github.com/grafana/pyroscope-go"

pyroscope.Start(pyroscope.Config{
    ApplicationName: "demo",
    ServerAddress:   "http://localhost:4040",
})
```

This is the smallest possible continuous-profiling setup. Touch it once and you'll understand why teams adopt it.

---

## Summary

Twelve tasks plus a bonus. Together they cover the same surface as the rest of the directory but force you to make the tool work rather than read about it. Save the profiles each task produces in a folder; you'll refer back to them later. The hardest task is #5 — finding a real change to a real codebase that the diff actually shows. That one is the closest to day-job pprof work.

---

## Further reading
- `pprof` interactive `help` command
- Profile format reference: https://github.com/google/pprof/blob/main/proto/profile.proto
- `runtime/pprof` API: https://pkg.go.dev/runtime/pprof
- Pyroscope quickstart: https://grafana.com/docs/pyroscope/latest/
