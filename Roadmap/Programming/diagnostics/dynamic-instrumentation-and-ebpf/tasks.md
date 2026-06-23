# Dynamic Instrumentation & eBPF — Hands-On Exercises

> **Topic:** [Dynamic Instrumentation & eBPF Roadmap](README.md)
>
> Observe a running program — or the Linux kernel itself — **without** touching source, recompiling, or restarting it. These exercises take you from a `BEGIN` hello-world to a libbpf CO-RE tool and a PID-targeted incident script.
>
> **Prerequisites:** A Linux box (bare metal, VM, or WSL2 with a real kernel), **root / `sudo`** (or `CAP_BPF` + `CAP_PERFMON` on 5.8+), and `bpftrace` + `bcc-tools` installed. A recent kernel helps a lot: **5.4+** for most of this, **5.8+** for `fentry`/`fexit` and `BPF_MAP_TYPE_RINGBUF`. CO-RE needs the kernel built with **BTF** (`CONFIG_DEBUG_INFO_BTF=y`) — check with `ls -l /sys/kernel/btf/vmlinux`. If that file is missing, the Capstone CO-RE exercise won't work without kernel headers and the legacy BCC path.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Warm-Up](#warm-up)
3. [Core](#core)
4. [Advanced](#advanced)
5. [Capstone](#capstone)
6. [If you can do all of these, you have the senior level](#if-you-can-do-all-of-these-you-have-the-senior-level)
7. [Related Topics](#related-topics)

---

## Introduction

These exercises are meant to be **typed and run**, not read. Each one gives you a goal, a setup, the steps, a collapsible solution with the exact command and an explanation, and a one-line takeaway. Difficulty climbs section by section.

**Set up an environment.** On Debian/Ubuntu:

```bash
sudo apt-get update
sudo apt-get install -y bpftrace bpfcc-tools linux-headers-$(uname -r)
```

On Fedora/RHEL: `sudo dnf install bpftrace bcc-tools kernel-devel`. No spare Linux box? Spin up a throwaway VM (`multipass launch --name ebpf 22.04` or Lima/Vagrant). Containers usually **don't** give you the privileges these probes need — use a VM or the host.

**Sanity checks before you start:**

```bash
uname -r                              # kernel version — 5.8+ unlocks fentry + ringbuf
ls -l /sys/kernel/btf/vmlinux         # exists => BTF present => CO-RE works
sudo bpftrace -e 'BEGIN { printf("ok\n"); exit(); }'   # toolchain works?
id                                    # are you root, or do you have CAP_BPF?
```

BCC tools install with a `-bpfcc` suffix on Debian/Ubuntu (`execsnoop-bpfcc`). On other distros they may be plain `execsnoop` under `/usr/share/bcc/tools/`. Adjust names to match your system.

> **Safety.** eBPF programs are verified and can't crash the kernel, but a chatty `printf` probe on a hot path (e.g. every `sys_enter`) can flood your terminal and add measurable overhead. **Aggregate** (`count()`, `hist()`) instead of printing per-event whenever you can. Don't run heavy or experimental probes on shared production hosts — use your own VM.

---

## Warm-Up

### W1 — Your first probe: BEGIN hello-world

**Goal:** Confirm the toolchain runs and learn the probe → action shape.

**Setup:** Toolchain installed, `sudo` available.

**Do it:** Print a line once when the program starts, then exit cleanly.

<details><summary>Solution / Hint</summary>

```bash
sudo bpftrace -e 'BEGIN { printf("Hello, eBPF! pid=%d\n", pid); exit(); }'
```

`BEGIN` is a special probe that fires once when the script loads (mirror: `END` fires at teardown, where aggregated maps are auto-printed). `exit()` tells bpftrace to detach and quit. Every bpftrace statement is **`probe { action }`** — you'll repeat that shape forever.

</details>

**What you learned:** The `probe { action }` model and the `BEGIN`/`END` lifecycle hooks.

---

### W2 — Discover what you can hook with `-l`

**Goal:** List available probes so you stop guessing names.

**Setup:** None.

**Do it:** List every syscall-enter tracepoint, then every probe whose name contains `vfs_`.

<details><summary>Solution / Hint</summary>

```bash
sudo bpftrace -l 'tracepoint:syscalls:sys_enter_*'
sudo bpftrace -l '*vfs_*'
```

`-l` lists probes matching a glob. The probe taxonomy you'll use: **`tracepoint:`** (stable kernel-defined hooks — prefer these), **`kprobe:` / `kretprobe:`** (any kernel function entry/return — powerful but tied to internal names that change between versions), **`uprobe:` / `uretprobe:`** (user-space functions), **`usdt:`** (statically-defined user probes), **`profile:` / `interval:`** (timer-based), and **`software:` / `hardware:`** (perf events).

</details>

**What you learned:** How to enumerate probes and the difference between stable tracepoints and version-fragile kprobes.

---

### W3 — Count syscalls per process (one-liner)

**Goal:** Build your first aggregation map.

**Setup:** Have some activity running (a `find /`, a browser, anything).

**Do it:** Count syscalls grouped by process name. Let it run ~10s, then Ctrl-C.

<details><summary>Solution / Hint</summary>

```bash
sudo bpftrace -e 'tracepoint:raw_syscalls:sys_enter { @[comm] = count(); }'
```

`@` is a **map**. `@[comm]` keys it by the current process name (`comm`); `count()` increments per hit. On Ctrl-C, bpftrace runs the implicit `END` and prints every map sorted by value. `raw_syscalls:sys_enter` catches **all** syscalls in one probe — cheaper and more complete than attaching to each `syscalls:sys_enter_*` individually.

</details>

**What you learned:** Map aggregation with `count()` keyed by `comm` — the workhorse pattern that avoids per-event printf overhead.

---

### W4 — See processes and file opens live with BCC

**Goal:** Use prebuilt BCC tools instead of writing scripts.

**Setup:** `bpfcc-tools` installed. Open a second terminal to generate activity (run `ls`, `cat /etc/hostname`, launch an editor).

**Do it:** Watch every new process exec, then watch every file open, in real time.

<details><summary>Solution / Hint</summary>

```bash
sudo execsnoop-bpfcc        # one line per execve(): PCOMM, PID, PPID, RET, ARGS
sudo opensnoop-bpfcc        # one line per open()/openat(): PID, COMM, FD, ERR, PATH
```

These are Python wrappers around eBPF programs maintained in the BCC project. `execsnoop` hooks the exec path; `opensnoop` hooks the open path. They're the first reach-for tools in an incident: "what just ran?" and "what file is it failing to open?" Add `-x` to `opensnoop-bpfcc` to show only failed opens.

</details>

**What you learned:** The BCC tool catalog gives you battle-tested observability for free — know `execsnoop` and `opensnoop` cold.

---

### W5 — Trace `openat` with process name and filename

**Goal:** Read syscall arguments and turn a kernel pointer into a string.

**Setup:** Open a second terminal; run `cat /etc/hostname` while your trace is live.

**Do it:** Print the process name and the path for every `openat`.

<details><summary>Solution / Hint</summary>

```bash
sudo bpftrace -e 'tracepoint:syscalls:sys_enter_openat { printf("%-16s %s\n", comm, str(args->filename)); }'
```

`args->filename` is a **pointer in user memory**; `str()` safely copies it into the BPF program and bounds it. Find available fields with `sudo bpftrace -lv tracepoint:syscalls:sys_enter_openat`. This is per-event `printf`, so it's noisy by design — fine for a focused look, but switch to a map the moment you want totals.

</details>

**What you learned:** Reading `args->`, dereferencing user pointers with `str()`, and discovering argument names with `-lv`.

---

## Core

### C1 — Function-latency histogram (the entry/exit tid-join pattern)

**Goal:** Measure how long a kernel function takes and plot the distribution.

**Setup:** Generate disk/VFS activity (`dd if=/dev/zero of=/tmp/x bs=1M count=200; sync`).

**Do it:** Histogram the latency of `vfs_read`: timestamp on entry, subtract on return.

<details><summary>Solution / Hint</summary>

```bash
sudo bpftrace -e '
kprobe:vfs_read  { @start[tid] = nsecs; }
kretprobe:vfs_read /@start[tid]/ {
    @ns = hist(nsecs - @start[tid]);
    delete(@start[tid]);
}'
```

The pattern: stash the entry timestamp keyed by **`tid`** (thread id), then on return compute the delta and feed it to `hist()` (log2 buckets). Three things matter:

- **Key by `tid`, not `pid`.** `pid` in bpftrace is the thread-group id (the userspace "PID"); multiple threads share it, so concurrent calls would clobber each other's start time. `tid` is the unique kernel thread id.
- **The `/@start[tid]/` filter** drops returns that have no matching entry (the probe started mid-call).
- **`delete(@start[tid])`** frees the slot so the map doesn't grow unbounded.

</details>

**What you learned:** The canonical entry→exit latency measurement, why `tid` keying is mandatory, and `hist()` for distributions.

---

### C2 — Capture syscall args AND return code, joined by tid

**Goal:** Correlate what a call asked for with how it ended.

**Setup:** Run `cat /nonexistent` and `cat /etc/hostname` while tracing to get both a failure and a success.

**Do it:** Record the filename on `sys_enter_openat`, then on `sys_exit_openat` print the filename together with the return value (fd or `-errno`).

<details><summary>Solution / Hint</summary>

```bash
sudo bpftrace -e '
tracepoint:syscalls:sys_enter_openat { @fn[tid] = str(args->filename); }
tracepoint:syscalls:sys_exit_openat /@fn[tid]/ {
    printf("%-30s ret=%d\n", @fn[tid], args->ret);
    delete(@fn[tid]);
}'
```

The enter and exit tracepoints are **separate probes** firing at different times — `tid` is the join key that ties the request to its result. `args->ret` on the exit tracepoint is the syscall return: `>= 0` is the fd, negative is `-errno` (e.g. `-2` = `ENOENT`). Same stash-on-enter / use-and-delete-on-exit discipline as C1.

</details>

**What you learned:** Joining two probes by `tid`, and reading negative-errno return conventions.

---

### C3 — Scope a trace to a single PID

**Goal:** Cut noise by tracing exactly one process.

**Setup:** Pick a target: `pgrep -n firefox`, or start `sleep 1000 &` and note its PID.

**Do it:** Count syscalls by name **only** for that PID.

<details><summary>Solution / Hint</summary>

```bash
TARGET=$(pgrep -n sleep)      # or any PID
sudo bpftrace -e "tracepoint:raw_syscalls:sys_enter /pid == $TARGET/ { @[comm] = count(); }"
```

The `/pid == N/` **predicate** runs first; the action only executes when it's true, so you filter in-kernel before any aggregation. Note `pid` here is the userspace PID (thread-group id) — exactly what `pgrep` returns, so the match is correct. (Many BCC tools accept `-p PID` for the same effect, e.g. `opensnoop-bpfcc -p $TARGET`.)

</details>

**What you learned:** In-kernel filtering with predicates, and the `pid` vs `tid` distinction in a filtering context.

---

### C4 — Watch TCP connects and retransmits with BCC

**Goal:** Diagnose network behavior without `tcpdump`.

**Setup:** Generate traffic: `curl -s https://example.com >/dev/null` in another terminal; for retransmits, hit a flaky/remote endpoint or use `tc` to inject loss.

**Do it:** Trace outbound TCP connections, then trace retransmissions.

<details><summary>Solution / Hint</summary>

```bash
sudo tcpconnect-bpfcc     # PID, COMM, IP, SADDR, DADDR, DPORT for each connect()
sudo tcpretrans-bpfcc     # TIME, PID, IP, LADDR:LPORT > RADDR:RPORT, STATE per retransmit
```

`tcpconnect` hooks the kernel's `tcp_v4_connect`/`tcp_v6_connect` path, giving you the connection 5-tuple and the responsible process — far lighter than packet capture because it only fires on connection setup. `tcpretrans` fires on the retransmit path; a steady stream of these points at packet loss or an overloaded peer. Both are kprobe-based, so behavior can vary slightly across kernels.

</details>

**What you learned:** Network-event tracing at the socket layer with `tcpconnect`/`tcpretrans`, and why it beats packet capture for "who is connecting / what is dropping."

---

### C5 — uprobe your OWN binary's function (no source change, no recompile)

**Goal:** Instrument a user-space function in a *running* binary you didn't modify.

**Setup:** Write and compile a tiny program **once**, then leave it untouched.

```c
// add.c
#include <stdio.h>
#include <unistd.h>
long add(long a, long b) { return a + b; }
int main(void) {
    for (long i = 0; ; i++) { volatile long r = add(i, i + 1); (void)r; sleep(1); }
}
```

```bash
gcc -O0 -o add add.c      # -O0 so 'add' isn't inlined away; symbol must survive
./add &                   # leave it RUNNING
```

**Do it:** Without recompiling or restarting `./add`, trace each call to `add` and print its two arguments.

<details><summary>Solution / Hint</summary>

```bash
sudo bpftrace -e 'uprobe:./add:add { printf("add(%d, %d)\n", arg0, arg1); }'
```

`uprobe:BINARY:SYMBOL` attaches to the function entry **in the live process's text** — no source edit, no recompile, no restart. `arg0`, `arg1` are the function arguments by calling convention (on x86-64 SysV: `rdi`, `rsi`). Use `uretprobe:./add:add { printf("=> %d\n", retval); }` for the return value.

Caveats that bite people: the symbol must exist in the binary (don't `strip` it; static/exported functions are easiest). At `-O2` the compiler may inline `add`, leaving no entry point to hook — that's why we used `-O0`. For a function in a shared library, point the path at the `.so` (e.g. `uprobe:/lib/x86_64-linux-gnu/libc.so.6:malloc`).

</details>

**What you learned:** The core promise of dynamic instrumentation — hooking a *running, unmodified* binary — plus inlining and symbol-stripping gotchas.

---

### C6 — Disk I/O latency histogram with BCC

**Goal:** See block-device latency as a distribution.

**Setup:** Generate I/O: `dd if=/dev/zero of=/tmp/io.bin bs=1M count=500 oflag=direct` (or a `fio` job) while tracing.

**Do it:** Plot block I/O latency, then break it down by disk.

<details><summary>Solution / Hint</summary>

```bash
sudo biolatency-bpfcc          # power-of-two histogram of block I/O latency
sudo biolatency-bpfcc -D 5 1   # per-disk (-D), one 5-second sample
```

`biolatency` is the BCC version of C1's pattern applied to the block layer: it timestamps requests at issue and computes latency at completion, bucketing into a log2 histogram. Reading the histogram matters more than the mean — a fat tail at high latency (a bimodal distribution) often reveals a struggling device or queue contention that an average would hide.

</details>

**What you learned:** Reading latency *distributions* (not averages) and applying the entry/exit pattern at the block layer via a prebuilt tool.

---

## Advanced

### A1 — Off-CPU time analysis via `sched:sched_switch`

**Goal:** Find where a thread spends time **blocked** (waiting), not running.

**Setup:** Run something that blocks on I/O or locks (`dd`, a database, `sleep`-heavy app).

**Do it:** Measure how long each thread stays off-CPU between being switched out and switched back in, as a per-comm histogram.

<details><summary>Solution / Hint</summary>

```bash
sudo bpftrace -e '
tracepoint:sched:sched_switch {
    // record when the OUTGOING thread leaves the CPU
    @off[args->prev_pid] = nsecs;
    // measure how long the INCOMING thread was away
    $t = @off[args->next_pid];
    if ($t) {
        @us[args->next_comm] = hist((nsecs - $t) / 1000);
        delete(@off[args->next_pid]);
    }
}'
```

`sched_switch` fires on every context switch with `prev_*` (going off-CPU) and `next_*` (coming on-CPU) fields. We stamp the time a thread is switched out, and when it returns we compute its off-CPU duration. This is the foundation of **off-CPU analysis**: on-CPU profiling shows where you burn cycles, off-CPU shows where you *wait* (disk, locks, network) — often the real latency culprit. Keying is by the kernel pid here (`prev_pid`/`next_pid` are kernel tids). For richer output, BCC's `offcputime-bpfcc` adds stack traces.

</details>

**What you learned:** Off-CPU vs on-CPU analysis, and harvesting both sides of `sched_switch` to measure blocked time.

---

### A2 — Aggregate user+kernel stacks to find the culprit

**Goal:** Build a flame-graph-style "where is the time going" list.

**Setup:** A CPU-busy target (`yes > /dev/null &`, or your app under load); note its PID.

**Do it:** Sample stacks and rank the hottest user+kernel call paths.

<details><summary>Solution / Hint</summary>

```bash
TARGET=$(pgrep -n yes)
sudo bpftrace -e "profile:hz:99 /pid == $TARGET/ { @[kstack, ustack] = count(); }"
```

Each unique `[kstack, ustack]` pair becomes a map key; `count()` ranks them, so the bottom of the printed output (highest count) is your hot path. Pipe the folded output into Brendan Gregg's `flamegraph.pl` to render an actual flame graph, or use BCC's `profile-bpfcc -f` for folded format directly. For readable userspace frames you need symbols — un-stripped binaries, or `-fno-omit-frame-pointer` builds (or DWARF unwinding) so the stack walker can resolve names instead of raw addresses.

</details>

**What you learned:** Stack aggregation as map keys for flame graphs, and why symbol/frame-pointer availability makes or breaks readability.

---

### A3 — CPU profiling with `profile:hz:99`

**Goal:** Sampled CPU profiling — understand *why 99 Hz*.

**Setup:** Run a CPU-bound workload.

**Do it:** Sample the on-CPU process name 99 times per second across all CPUs for 10s.

<details><summary>Solution / Hint</summary>

```bash
sudo bpftrace -e 'profile:hz:99 { @[comm] = count(); } interval:s:10 { exit(); }'
```

`profile:hz:99` fires a timer on **every CPU** 99 times a second. Why 99 and not 100? To avoid **lockstep** — if you sample at exactly 100 Hz you can phase-align with periodic kernel work (timers, the 100/250/1000 Hz scheduler tick) and systematically over- or under-count it. An off-by-one rate like 99 dodges that aliasing. The whole approach is *statistical*: more samples → more accurate profile, but it can miss rare short events entirely. `interval:s:10 { exit(); }` bounds the run.

</details>

**What you learned:** Sampled (statistical) profiling, the 99 Hz anti-aliasing trick, and timer-bounded runs with `interval`.

---

### A4 — `fentry`/`fexit` vs `kprobe`

**Goal:** Use the modern BPF trampoline hooks and know when they win.

**Setup:** Kernel **5.5+** with BTF (`fexit` needs 5.5+; both need BTF).

**Do it:** Histogram `vfs_read` latency with `fentry`/`fexit` and compare to the C1 kprobe version.

<details><summary>Solution / Hint</summary>

```bash
sudo bpftrace -e '
fentry:vfs_read { @start[tid] = nsecs; }
fexit:vfs_read /@start[tid]/ {
    @ns = hist(nsecs - @start[tid]);
    delete(@start[tid]);
}'
```

`fentry`/`fexit` attach via a BPF **trampoline** instead of a breakpoint trap, so they're lower-overhead than `kprobe`/`kretprobe`. Two more wins: `fexit` can read the **function arguments** (a `kretprobe` only sees the return value — that's the whole reason C1/C2 had to stash args on the entry probe), and they take typed BTF arguments (`args->...`) instead of raw `arg0`. The cost: they require kernel 5.5+ and BTF, so they're less portable than kprobes, which work almost anywhere. Rule of thumb: **prefer `fentry`/`fexit` on modern kernels, fall back to kprobes for portability.**

</details>

**What you learned:** BPF trampolines vs kprobe traps, that `fexit` sees args (`kretprobe` doesn't), and the portability trade-off.

---

### A5 — Trigger a verifier rejection in BCC, then fix it

**Goal:** Understand the verifier by deliberately failing it.

**Setup:** BCC installed (`python3-bpfcc`).

**Do it:** Write a BCC program that dereferences a kernel-returned pointer **without** a NULL check, watch the verifier reject it, then add the check.

<details><summary>Solution / Hint</summary>

**The rejected version** — `bpf_get_current_task()` may return NULL, and we dereference it blindly:

```python
# verifier_fail.py
from bcc import BPF
prog = r'''
#include <linux/sched.h>
int hook(void *ctx) {
    struct task_struct *t = (struct task_struct *)bpf_get_current_task();
    int pid = t->pid;            // verifier: dereferencing possibly-NULL pointer
    bpf_trace_printk("pid=%d\n", pid);
    return 0;
}
'''
BPF(text=prog).attach_kprobe(event="vfs_read", fn_name="hook")
```

Running it dumps a verifier log ending in something like `R1 invalid mem access 'inv'` / `dereference of modified ... pointer` — the verifier refuses to load it because it can't prove the access is safe.

**The fix** — prove safety with an explicit NULL check:

```c
struct task_struct *t = (struct task_struct *)bpf_get_current_task();
if (!t) return 0;               // now the verifier knows t is non-NULL below
int pid = t->pid;
```

The **verifier** is the kernel component that statically proves your program is safe (bounded loops, no out-of-bounds or NULL access, finite instruction count) *before* it ever runs — that's why eBPF can't crash the kernel. It tracks each register's possible values; an `if (!ptr) return;` collapses the NULL case so the later dereference is provably safe. (In raw libbpf you'd read kernel memory with `bpf_probe_read_kernel()`, which the verifier also requires for non-trivial pointer chases; BCC rewrites bare dereferences into those calls for you.)

</details>

**What you learned:** What the verifier checks and why, how to read a rejection, and that NULL-checks aren't optional — they're how you *prove* safety to the kernel.

---

## Capstone

### CAP1 — A real libbpf CO-RE tool (ringbuf openat tracer)

**Goal:** Write a portable, compile-once-run-everywhere BPF tool with a kernel-side program and a user-space loader — the production shape of eBPF tooling.

**Setup:** `clang`, `llvm`, `libbpf-dev`, `bpftool`, BTF kernel. Generate the kernel type header **once**:

```bash
bpftool btf dump file /sys/kernel/btf/vmlinux format c > vmlinux.h
```

**Do it:** Build a tool that pushes one event per `openat` (pid, comm, filename) through a **ringbuf** to userspace, which prints them. CO-RE (Compile Once – Run Everywhere) means the single compiled object relocates field offsets against the *running* kernel's BTF, so it runs on kernels you never compiled against.

<details><summary>Solution / Hint</summary>

**Kernel side — `opensnoop.bpf.c`:**

```c
#include "vmlinux.h"
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_core_read.h>
#include <bpf/bpf_tracing.h>

char LICENSE[] SEC("license") = "GPL";

struct event {
    __u32 pid;
    char  comm[16];
    char  filename[128];
};

/* ring buffer: 256 KB */
struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 256 * 1024);
} rb SEC(".maps");

SEC("tp/syscalls/sys_enter_openat")
int handle_openat(struct trace_event_raw_sys_enter *ctx)
{
    struct event *e = bpf_ringbuf_reserve(&rb, sizeof(*e), 0);
    if (!e)                                 // verifier-required NULL check
        return 0;

    e->pid = bpf_get_current_pid_tgid() >> 32;
    bpf_get_current_comm(&e->comm, sizeof(e->comm));

    const char *fn = (const char *)ctx->args[1];   // openat: filename is arg #1
    bpf_probe_read_user_str(e->filename, sizeof(e->filename), fn);

    bpf_ringbuf_submit(e, 0);
    return 0;
}
```

**Build the object and generate the skeleton:**

```bash
clang -g -O2 -target bpf -D__TARGET_ARCH_x86 \
      -c opensnoop.bpf.c -o opensnoop.bpf.o
bpftool gen skeleton opensnoop.bpf.o > opensnoop.skel.h
```

**User side — `opensnoop.c`:**

```c
#include <stdio.h>
#include <signal.h>
#include <bpf/libbpf.h>
#include "opensnoop.skel.h"

struct event { unsigned int pid; char comm[16]; char filename[128]; };

static volatile int stop = 0;
static void on_sig(int s) { stop = 1; }

static int on_event(void *ctx, void *data, size_t len) {
    struct event *e = data;
    printf("%-8u %-16s %s\n", e->pid, e->comm, e->filename);
    return 0;
}

int main(void) {
    struct opensnoop_bpf *skel = opensnoop_bpf__open_and_load();   // open + verify + load
    if (!skel) { fprintf(stderr, "open_and_load failed\n"); return 1; }
    if (opensnoop_bpf__attach(skel)) { fprintf(stderr, "attach failed\n"); goto out; }

    struct ring_buffer *rb =
        ring_buffer__new(bpf_map__fd(skel->maps.rb), on_event, NULL, NULL);
    if (!rb) { fprintf(stderr, "ringbuf new failed\n"); goto out; }

    signal(SIGINT, on_sig);
    printf("%-8s %-16s %s\n", "PID", "COMM", "FILENAME");
    while (!stop)
        ring_buffer__poll(rb, 100 /*ms*/);     // drain events, 100ms timeout

    ring_buffer__free(rb);
out:
    opensnoop_bpf__destroy(skel);
    return 0;
}
```

**Compile & run:**

```bash
clang -O2 opensnoop.c -lbpf -lelf -lz -o opensnoop
sudo ./opensnoop
```

Why each piece: **`vmlinux.h`** gives kernel struct definitions so you never ship kernel headers; the relocations clang emits with `-g` let libbpf fix field offsets against the target's `/sys/kernel/btf/vmlinux` at load — that's CO-RE. **`BPF_MAP_TYPE_RINGBUF`** is the modern (5.8+) replacement for perf buffers: a single MPSC buffer with `reserve`/`submit` (commit) semantics and no per-CPU duplication. `reserve` can return NULL when the buffer is full, hence the check. The **skeleton** (`*.skel.h`) embeds the BPF object and generates `open_and_load`/`attach`/`destroy` plus typed map accessors, so the loader is a few lines. `ring_buffer__poll` is your event pump.

(If your kernel predates ringbuf, swap to `BPF_MAP_TYPE_PERF_EVENT_ARRAY` and `perf_buffer__new`/`perf_buffer__poll` — same idea, older API.)

</details>

**What you learned:** The full production eBPF shape — `vmlinux.h` + CO-RE relocations, a ringbuf map, a `SEC()` tracepoint handler, and a skeleton-driven libbpf loader.

---

### CAP2 — Trace USDT probes in a JVM or CPython

**Goal:** Hook **statically-defined** user probes baked into a runtime — zero source change to your app.

**Setup:** A runtime built **with** USDT/DTrace probes. The JVM has them in most distributions (try `--enable-dtrace` builds / OpenJDK); CPython needs to be configured **`--with-dtrace`** (stock distro Python usually *isn't*, so you may need to build it or use a tracing-enabled build).

**Do it:** First **list** the probes a binary exposes, then trace one.

<details><summary>Solution / Hint</summary>

**List probes** in a target (point the path at the actual binary/lib):

```bash
sudo bpftrace -l 'usdt:/usr/lib/jvm/.../lib/server/libjvm.so:*'   # JVM
sudo bpftrace -l 'usdt:/usr/local/bin/python3.12:*'              # CPython --with-dtrace
```

**Trace a JVM GC begin** (fires when a garbage collection starts):

```bash
sudo bpftrace -e 'usdt:/usr/lib/jvm/.../libjvm.so:hotspot:gc__begin { printf("GC begin on %s\n", comm); }'
```

**Trace a CPython function entry** (file, function, line from the probe arguments):

```bash
sudo bpftrace -e 'usdt:/usr/local/bin/python3.12:python:function__entry {
    printf("%s:%s line %d\n", str(arg0), str(arg1), arg2);
}'
```

**USDT** (User Statically-Defined Tracing) probes are markers the runtime *authors* embedded at semantically meaningful points (`gc__begin`, `function__entry`, `method__entry`). Unlike a uprobe — which hooks an arbitrary symbol address — USDT gives you a **stable, named, documented** hook with curated arguments. The catch: the marker only exists if the binary was **compiled to include it**. If `-l` returns nothing, your JVM/Python build simply doesn't carry the probes — rebuild with the flag or grab a probe-enabled package. (To run a probe-enabled CPython quickly: `git clone cpython && ./configure --with-dtrace && make`.)

</details>

**What you learned:** USDT as stable, author-blessed probe points; how to list them; and that they only exist when the runtime was built with them enabled.

---

### CAP3 — A PID-targeted incident toolkit `.bt` script

**Goal:** Package everything into one reusable tool an on-call engineer can point at a misbehaving PID.

**Setup:** Save the script, `chmod +x`, pick a victim PID.

**Do it:** Write `incident.bt` that takes a PID as `$1` and, for that PID, reports (a) syscall latency as a histogram and (b) the top syscalls by count — printing a summary every 5 seconds.

<details><summary>Solution / Hint</summary>

```bash
#!/usr/bin/env bpftrace
// incident.bt — usage: sudo ./incident.bt <PID>

BEGIN {
    printf("Tracing PID %d ... Ctrl-C to stop. 5s summaries.\n", $1);
}

// stash entry time per thread, only for our target PID
tracepoint:raw_syscalls:sys_enter /pid == $1/ {
    @start[tid] = nsecs;
    @count[probe] = count();           // top syscalls (probe name = which call)
}

// on exit, compute latency for matched entries
tracepoint:raw_syscalls:sys_exit /pid == $1 && @start[tid]/ {
    @latency_us = hist((nsecs - @start[tid]) / 1000);
    delete(@start[tid]);
}

// periodic snapshot
interval:s:5 {
    time("\n=== %H:%M:%S ===\n");
    print(@latency_us);
    print(@count, 5);                  // top 5 only
    clear(@latency_us);
    clear(@count);
}

END { clear(@start); }
```

Run it:

```bash
chmod +x incident.bt
sudo ./incident.bt $(pgrep -n nginx)
```

This is the synthesis: a **shebang `.bt` script** (a real executable), **positional args** (`$1`), the **tid-keyed entry/exit latency** pattern (C1/C2), **PID scoping** via predicate (C3), `count()` keyed by `probe` for a top-N syscall list, and **`interval` + `print`/`clear`** for a rolling live dashboard. `print(@map, 5)` truncates to the top 5; `clear()` resets each window so the numbers are per-interval, not cumulative. This is genuinely how people triage "process X is slow right now" with eBPF.

</details>

**What you learned:** Composing probes, predicates, args, aggregation, and intervals into a single deployable triage tool — the practical payoff of everything above.

---

## If you can do all of these, you have the senior level

You can attach to **any** layer of a running system — syscalls, kernel functions (kprobe and fentry/fexit), user functions (uprobe), and runtime USDT markers — **without** editing, recompiling, or restarting a thing. You instinctively reach for **aggregation over per-event printf**, key latency by **`tid`** with delete-on-exit, **scope to a PID** to kill noise, and read **distributions** instead of averages. You understand the **verifier** well enough to predict and fix a rejection, you know when **fentry/fexit** beats a kprobe (and when portability sends you back to kprobes), and you can build a real **libbpf CO-RE** tool — `vmlinux.h`, a ringbuf, a `SEC()` handler, a skeleton loader — that ships as one binary and runs across kernel versions. If you can hand an on-call engineer a `.bt` script that takes a PID and surfaces the culprit in five seconds, you're operating at the senior level.

---

## Related Topics

- [Continuous Profiling](../continuous-profiling/) — always-on, fleet-wide stack sampling (the productionized cousin of A2/A3).
- [Tracing](../tracing/) — distributed request tracing; eBPF can feed and correlate with it.
- [Metrics](../metrics/) — aggregate counters/histograms; eBPF maps are a metrics source.
- [Logging](../logging/) — event records; contrast with eBPF's structured, low-overhead events.
- [Debugging](../debugging/) — interactive and post-mortem techniques alongside live instrumentation.
- [Observability Engineering](../observability-engineering/) — how instrumentation, traces, metrics, and logs combine into a coherent practice.
