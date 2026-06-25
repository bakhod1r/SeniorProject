# JIT Compilation & Tiering — Junior Level

> **Topic:** [JIT Compilation & Tiering](README.md)
> **Focus:** What a Just-In-Time compiler actually does while your program runs, why "slow at first, fast later" is normal, and why a JIT can sometimes beat a compiler that ran ahead of time.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Summary](#summary)
14. [Further Reading](#further-reading)

---

## Introduction

> Focus: **What does "Just-In-Time" mean?** And **why does the same program run slowly for the first second and then suddenly speed up?**

When you run a Java program, a JavaScript file in a browser, or a C# service, the code does **not** start as fast machine instructions. It starts as something slower — bytecode that an **interpreter** reads and executes one operation at a time. The interpreter is like a person reading a recipe out loud and doing each step as they read it: correct, but not fast.

A **Just-In-Time compiler** (JIT) is a piece of the language runtime that watches your program run, notices which functions get called over and over, and **translates those hot functions into native machine code on the fly** — *just in time*, right when they are needed, while the program is still running. After that translation, the runtime stops interpreting those functions and runs the compiled machine code directly. That is the speed-up you feel.

The single most surprising idea on this page is this: **a JIT can produce faster code than a normal ahead-of-time compiler** like a C compiler. That sounds impossible — the C compiler had all the time in the world and the JIT is rushed. The reason is that the JIT has something the C compiler never had: it can *watch the program actually run* and see real data. It learns "this list almost always holds `String` objects," "this `if` is taken 99% of the time," "this method is always the same concrete type," and it compiles code that is optimized for *what really happens*, not for every theoretical possibility. The ahead-of-time compiler had to be cautious because it could not see the future. The JIT lives in the future.

In one sentence: **a JIT trades a slow start for a fast steady state, by spying on your running program and compiling the parts that matter into machine code tuned to the real data.**

> 🎓 **Why this matters for a junior:** You will eventually hear someone say "the JVM is slow" or "Java is slow," usually after timing a program that ran for half a second. They measured the *warmup* — the period before the JIT kicked in — and mistook it for the program's real speed. Understanding warmup is the difference between writing a correct benchmark and writing a misleading one. It also explains why your service is sluggish for the first few seconds after a deploy, and why "just restart it" sometimes makes performance *worse* for a while.

This page covers: what an interpreter is and why it is slow, what the JIT does and *when*, the idea of **counters** that decide when a function is "hot," **tiered compilation** (a fast-but-rough compiler first, a slow-but-excellent compiler later), why warmup happens, and how to actually *see* the JIT working with simple flags. The next level (`middle.md`) goes deep into the real tiers of HotSpot and V8 and on-stack replacement; `senior.md` covers the profile-guided optimizations themselves; `professional.md` covers code-cache management and production warmup strategy.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to write and run a simple program in at least one managed language — Java, C#, JavaScript (Node.js), or Python.
- **Required:** What a function/method is and what "calling a function many times in a loop" means.
- **Required:** A rough idea that your CPU runs *machine instructions* and that source code has to become those instructions somehow.
- **Helpful but not required:** Having seen the words "compiler" and "interpreter" before.
- **Helpful but not required:** A vague sense that a `for` loop body might run millions of times.

You do **not** need to know:

- How a register allocator or instruction scheduler works (that is far beyond this level).
- The specific optimization passes a JIT applies (that is `senior.md`).
- How deoptimization undoes a bad guess (that is a separate topic, mentioned only in passing here).
- Assembly language. We will talk *about* machine code without reading any.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Source code** | The text you write (`.java`, `.js`, `.cs`). Humans read it; CPUs cannot run it directly. |
| **Machine code** | The raw native instructions the CPU actually executes. Fast. This is what a JIT produces. |
| **Bytecode** | A compact, portable middle form between source and machine code (Java `.class`, .NET IL, Python `.pyc`). Not native; needs an interpreter or JIT. |
| **Interpreter** | A program that reads bytecode and performs each operation one at a time. Simple, portable, slow. |
| **Compiler** | A program that translates code into machine code. A JIT is a compiler that runs *during* your program. |
| **AOT (Ahead-Of-Time)** | Compiling to machine code *before* the program runs (the classic C/C++/Go/Rust model). The opposite of JIT in timing. |
| **JIT (Just-In-Time)** | Compiling to machine code *while* the program runs, on demand, guided by what the program is doing. |
| **Hot code** | A function or loop that runs often enough to be worth compiling. The JIT focuses only on hot code. |
| **Cold code** | Code that runs rarely (error handlers, startup). Usually left to the interpreter — compiling it would not pay off. |
| **Counter** | A small tally the runtime keeps: "how many times has this method been called?" When it crosses a threshold, the JIT compiles the method. |
| **Threshold** | The counter value that triggers compilation (e.g., "compile after 10,000 invocations"). |
| **Warmup** | The early phase where code is still interpreted (or only lightly compiled) and the program is slower than its eventual steady state. |
| **Steady state** | After warmup, when hot code has been compiled and the program runs at full speed. |
| **Profile / profiling data** | The facts the runtime gathers while running: which types appear, which branches are taken, how often a loop spins. Fuel for smart compilation. |
| **Tier** | A level in a multi-stage compilation pipeline. Lower tiers compile fast and produce so-so code; higher tiers compile slowly and produce great code. |
| **Tiered compilation** | The strategy of moving a hot method up through tiers as it proves itself worth more effort. |
| **OSR (On-Stack Replacement)** | Swapping a long-running loop from interpreted to compiled code *while it is still running*, without waiting for the function to be called again. |
| **Code cache** | The region of memory where the JIT stores the machine code it generates. It has a size limit. |
| **Inlining** | Pasting a small called function's body directly into the caller, removing the call. The JIT's most important optimization. |

---

## Core Concepts

### 1. Why bytecode starts slow

When you compile a Java file, you do **not** get machine code — you get **bytecode** in a `.class` file. Bytecode is a tidy list of simple operations for an imaginary "virtual machine" (the JVM). JavaScript is even more direct: the browser receives plain source text and turns it into bytecode internally.

The reason bytecode exists is portability: the same `.class` file runs on an x86 laptop, an ARM phone, and a mainframe. But the CPU cannot execute bytecode. Something has to bridge the gap. The simplest bridge is an **interpreter**: a big loop that reads one bytecode instruction, does what it says, reads the next, and so on.

The interpreter works everywhere and starts instantly — there is nothing to compile. But it is slow, often **10× to 100× slower** than native code, because for every tiny operation (`add two numbers`) it pays overhead: fetch the bytecode, figure out what it means, jump to the handler, do the work. The actual "add" is one CPU instruction; the bookkeeping around it is dozens.

### 2. The JIT's bargain: spend time to save time

Compiling a function to machine code costs CPU time *now*. If a function only ever runs once (say, your `main()` startup logic), compiling it is a waste — you would spend more time compiling than you would ever save. But if a function runs **a million times** inside a loop, then paying to compile it once and running the fast version a million times is an enormous win.

So the runtime makes a bet on every function: *is this going to run often enough that compiling it pays off?* It cannot know the future, so it **counts**. Every method has an invocation counter. Every loop has a back-edge counter (counting how many times the loop jumped back to the top). When a counter crosses a threshold, the runtime concludes "this is hot" and hands the method to the JIT.

This is why **cold code stays interpreted forever**. Your error-handling branch that runs once a week never gets compiled, and that is correct — compiling it would be pure waste.

### 3. Tiered compilation: fast-and-rough, then slow-and-good

Here is a tension. A *good* optimizing compiler is slow — it analyzes the code deeply and produces excellent machine code. But if you make every hot method wait for the slow compiler, the program stays in the slow interpreter for a long time. That hurts startup.

The solution is **tiers**. Think of it as a ladder:

1. **Interpreter** — instant, no compilation, slowest execution.
2. **A quick compiler** ("baseline" or "template" JIT) — compiles fast, produces decent (not great) machine code. Gets you off the interpreter quickly.
3. **An optimizing compiler** — compiles slowly, produces excellent machine code. Reserved for the *hottest* methods that have proven they deserve the investment.

A method climbs the ladder. It starts interpreted. When it gets warm, the quick compiler gives it decent machine code right away. While that decent code runs, the runtime keeps gathering **profiling data** about it. When it gets *truly* hot, the optimizing compiler uses all that gathered data to produce a highly tuned version, and the method graduates to the top tier.

This is the best of both worlds: fast startup (the quick tier) **and** fast steady state (the top tier), with the expensive compiler only used where it pays.

### 4. Counters and thresholds (the simple version)

The runtime keeps two main counts per method:

- **Invocation counter** — how many times the method was entered.
- **Back-edge counter** — how many times a loop inside the method jumped back to its start.

The back-edge counter matters because of a special case: imagine `main()` contains one giant loop that runs ten million times. The *method* `main` was only called **once**, so its invocation counter is stuck at 1. But the loop inside is blazing hot. If we only watched invocation counters, we would never compile it. The back-edge counter catches this.

When a counter passes its threshold, the method is queued for compilation. The threshold is just a tuned number — high enough that one-shot code never qualifies, low enough that genuinely hot code gets compiled promptly.

### 5. On-Stack Replacement (OSR), gently

Back to that giant loop in `main()`. Suppose it has already run two million times in the interpreter and the back-edge counter finally trips. We want to switch to compiled code — but the loop is **still running right now**, in the middle of iteration two million. We cannot wait for `main()` to be called again, because it never will be.

**On-Stack Replacement** is the trick that swaps the running, interpreted loop for a compiled version *mid-flight*. The runtime compiles the loop, then carefully transfers the current state (the loop variable, the partial results) from the interpreter's world into the compiled code's world, and jumps into the compiled loop at the right iteration. The loop never stops; it just suddenly gets faster. As a junior, you only need to know that this exists and *why* — long-running loops would otherwise be stuck slow forever.

### 6. Why warmup happens (and why it confuses people)

Put the pieces together and warmup is obvious:

- **Second 0:** everything is interpreted. Slow.
- **Second 1:** hot methods get quick-tier compilation. Faster.
- **Second 5:** the hottest methods reach the top optimizing tier. Full speed.

So the *same program* gets faster over its first several seconds without you changing anything. If you measure its speed at second 0 and announce "this language is slow," you measured warmup, not the language.

This is also why **a fresh process is slow**. After a deploy or a restart, every JIT-managed service starts cold and has to warm up all over again. Senior engineers plan for this; juniors are surprised by it.

---

## Real-World Analogies

**The new line cook.** A new cook reads every order off the ticket, looks up the recipe, and follows it step by step — that is the interpreter. After making the same burger fifty times, the cook has it memorized and makes it without looking — that is compiled hot code. They never bother memorizing the dish that gets ordered once a month — that stays "interpreted." And crucially, after watching which dishes actually sell, the kitchen reorganizes the station to make the popular ones fast. That reorganization based on *observed* demand is profile-guided optimization: the cook optimized for the real menu, not the theoretical one.

**Paving the desire path.** A new park has grass everywhere and concrete nowhere — walk anywhere, slowly (interpreter). The groundskeeper watches where people actually walk, and after a while pours concrete on the worn dirt tracks — the *desire paths* (hot code). They do not pave the whole park; they pave only where traffic proved it was worth it. An architect drawing paths before the park opened (AOT) would have guessed; the groundskeeper *measured*.

**Learning a commute.** Your first drive to a new job, you follow the GPS turn by turn (interpreter, slow). After a month you know the route cold and even know which lane to be in before each turn (top-tier compiled). And you have learned real traffic patterns the map app could not predict in advance — "this shortcut is faster at 5pm" — so you sometimes beat the GPS's a-priori plan. That is the JIT beating AOT.

---

## Mental Models

**Model 1 — The escalator of tiers.** Picture code riding an escalator. The bottom is the interpreter (everyone starts here). The middle step is the quick compiler. The top is the optimizing compiler. Cold code stands at the bottom forever. Warm code rides up one step. Truly hot code rides all the way to the top. Nothing is forced up; you have to earn each step by being run often enough.

**Model 2 — The counter is a thermostat.** Each method has a little thermometer (its counter). Below the threshold it is "cold" — leave it interpreted. Cross the threshold and it is "hot" — turn on the compiler. The thermostat is what makes the system *adaptive*: it spends compilation effort exactly where the program actually puts its time.

**Model 3 — The JIT is a gambler with hindsight.** Every optimization the JIT makes is a *bet* based on what it has seen: "this variable has always been an integer, so I'll compile integer-only code." Usually the bet pays off and the code is fast. Occasionally the program does something new and the bet was wrong — at which point the runtime quietly throws away the compiled code and falls back to the interpreter (that fallback is "deoptimization," covered in its own topic). The key intuition: **fast JIT code is fast precisely because it assumes things, and assumptions can be wrong.**

**Model 4 — Warmup is a loan you pay back.** The program "borrows" speed by spending early CPU on compilation. The loan is repaid every time the fast compiled code runs instead of the slow interpreter. Short-lived programs (run for half a second) never run long enough to repay the loan — they pay the warmup cost and quit before reaping the reward. Long-lived servers repay it millions of times over. This is the single most important practical fact about JITs.

---

## Code Examples

The point of these examples is to *observe* the JIT, not to write one. We will run small programs and ask the runtime to show its work.

### Example 1 — Feeling warmup in Java

```java
public class Warmup {
    // A function the JIT will eventually compile because we call it a lot.
    static long work(long n) {
        long sum = 0;
        for (long i = 0; i < n; i++) {
            sum += (i * 31) ^ (i >> 3);
        }
        return sum;
    }

    public static void main(String[] args) {
        // Run the same work() many times and time each batch.
        for (int round = 0; round < 10; round++) {
            long start = System.nanoTime();
            long acc = 0;
            for (int k = 0; k < 1000; k++) {
                acc += work(10_000);
            }
            long ms = (System.nanoTime() - start) / 1_000_000;
            System.out.println("round " + round + ": " + ms + " ms (acc=" + acc + ")");
        }
    }
}
```

Run it and watch the timings. The first few rounds are noticeably slower; then the time per round drops and flattens out. That drop is the JIT compiling `work()` and `main`'s loop. You did not change the code between rounds — the *runtime* changed how it was executed.

### Example 2 — Asking the JVM to narrate

The JVM can print every compilation it performs:

```bash
java -XX:+PrintCompilation Warmup
```

You will see a stream of lines like:

```text
  45    1       3       Warmup::work (28 bytes)
  46    2       4       Warmup::work (28 bytes)
```

Each line is a compilation event. The number after the method name region (the `3` then `4` above) is the **tier**: tier 3 is a quick profiling compile; tier 4 is the top optimizing compile. Seeing `work` appear first at a low tier and later at tier 4 *is* tiered compilation happening in front of you. (You do not need to memorize the exact columns — just recognize "my method got compiled, then recompiled at a higher tier.")

### Example 3 — Turning the top tier off

You can ask the JVM to stop at a lower tier and never use the heavy optimizing compiler:

```bash
java -XX:TieredStopAtLevel=1 Warmup
```

Now compare its steady-state speed to the default. It will usually be **slower** in steady state, because the best optimizations (the ones in the top tier) are now disabled. But it may *start* faster, because it never pays for the expensive compiles. This single experiment makes the whole startup-versus-throughput trade-off concrete.

### Example 4 — The same idea in Node.js (V8)

```js
// warmup.js
function work(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += (i * 31) ^ (i >> 3);
  }
  return sum;
}

for (let round = 0; round < 10; round++) {
  const start = process.hrtime.bigint();
  let acc = 0;
  for (let k = 0; k < 1000; k++) acc += work(10000);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  console.log(`round ${round}: ${ms.toFixed(1)} ms`);
}
```

Run with V8's optimization trace:

```bash
node --trace-opt --trace-deopt warmup.js
```

You will see lines saying V8 is *optimizing* `work` (it climbed to a higher tier) and, if anything surprises it, *deoptimizing* it. Same lesson as Java: the function starts slow, gets compiled, and speeds up — and the runtime will happily tell you when it does.

### Example 5 — A benchmark mistake you must never make

```java
// WRONG: this "benchmark" measures warmup, not steady-state speed.
long start = System.nanoTime();
long r = work(10_000_000);   // called exactly ONCE, all interpreted
long ms = (System.nanoTime() - start) / 1_000_000;
System.out.println(ms + " ms");   // reports the SLOW interpreted time
```

Because `work` is called once, the JIT may never compile it (or compiles it via OSR only partway through). The number you print is the cold, interpreted speed — which is *not* how the function performs in a real long-running program. The fix is to call the code thousands of times to let it warm up, **then** start timing. This is exactly why real benchmark tools (JMH for Java, `benchmark.js` for Node) force a warmup phase before measuring.

---

## Pros & Cons

**Pros of JIT compilation**

- **Profile-guided speed.** The JIT optimizes for what the program *actually* does, not for every theoretical case. This is why it can beat a cautious AOT compiler on the same code.
- **One binary, many CPUs.** Ship portable bytecode; the JIT compiles to the exact CPU it lands on (using whatever instruction-set features that chip has).
- **Pays effort only where it matters.** Cold code stays cheap (interpreted); only hot code gets expensive compilation. Compilation budget follows the program's real hotspots.
- **Aggressive optimization is safe.** Because the runtime can undo a bad guess (deoptimize), the JIT can make optimistic assumptions an AOT compiler could never risk.

**Cons of JIT compilation**

- **Warmup.** Slow until hot code is compiled. Brutal for short-lived processes and serverless functions that may finish before they warm up.
- **Memory and CPU overhead at runtime.** The compiler itself, the profiling counters, and the generated machine code (the code cache) all consume resources *while your program runs*.
- **Unpredictable latency.** A compilation or deoptimization can happen mid-request, adding a latency spike. Bad for hard real-time systems.
- **Complexity.** A JIT runtime is vastly more complex than a simple AOT toolchain, which means more things that can go subtly wrong (code-cache exhaustion, deopt storms — later topics).

> 🎓 The pros and cons are really one trade-off seen from two sides: **a JIT spends resources during execution to learn from the running program.** If the program runs long enough, the learning pays for itself many times over. If it does not, you paid the cost and left before collecting the reward.

---

## Use Cases

**Where JITs shine:**

- **Long-running servers.** A web service that runs for days warms up once and then runs at full speed essentially forever. The ideal JIT scenario.
- **Heavy compute loops.** Numerical kernels, data processing, game logic — code dominated by tight hot loops that the optimizing tier loves.
- **Browsers.** JavaScript on a page you keep open (a web app, a game) gets hot and fast. V8, SpiderMonkey, and JavaScriptCore are all JITs for exactly this reason.
- **Dynamic languages.** Languages where types are not known ahead of time (JavaScript, Python via PyPy, Ruby) benefit enormously, because the JIT can *observe* the types at runtime and specialize.

**Where JITs struggle (and AOT often wins):**

- **Command-line tools** that start, do one thing, and exit. They die during warmup. (This is a major reason native-image / AOT options exist for the JVM.)
- **Serverless functions** billed per invocation with cold starts — paying warmup on every cold start is expensive and slow.
- **Hard real-time / embedded** systems that cannot tolerate a surprise compilation pause or the memory cost of a code cache.
- **Tiny memory environments** where the runtime, profiler, and code cache do not fit.

---

## Coding Patterns

These are habits that help you *work with* a JIT rather than against it. None require you to understand the JIT internals.

**Pattern 1 — Always warm up before benchmarking.**

```text
for a few thousand iterations:   # warmup: let the JIT compile
    run the code, ignore the time
now start the timer
for many iterations:             # measurement: steady state
    run the code
report the measured time
```

Or better: use a real harness (JMH, `benchmark.js`) that does this correctly for you.

**Pattern 2 — Write predictable, monomorphic code on hot paths.** A JIT optimizes best when a hot call site sees *one* concrete type. If a hot loop sometimes processes `Cat`, sometimes `Dog`, sometimes `int`, sometimes `String`, the JIT cannot specialize and produces slower code. Keep hot loops type-consistent. (You will hear the word "monomorphic" — it just means "one shape.")

**Pattern 3 — Keep hot methods small enough to inline.** The JIT's biggest win is **inlining** — pasting a small called method into its caller. Enormous methods do not get inlined and block optimization. Small, focused methods on the hot path tend to get inlined and run faster, which (pleasantly) is also good clean-code advice.

**Pattern 4 — Don't micro-optimize cold code.** Hand-tuning a startup routine or an error handler is wasted effort — it stays interpreted and runs rarely. Spend optimization energy where the counters are high, not where *you* think it looks slow.

---

## Best Practices

- **Measure steady state, not warmup.** Run the workload until timings stabilize before you trust any number. Most "language X is slow" claims are warmup measurements.
- **Let the runtime tell you what it did.** `-XX:+PrintCompilation` (JVM) and `--trace-opt`/`--trace-deopt` (Node/V8) are free narration. Use them when you are confused about performance.
- **Prefer the defaults until you can prove otherwise.** Tiered compilation defaults are tuned by people who do this full-time. Reach for `-XX:TieredStopAtLevel` and friends only with a measurement in hand.
- **Keep hot paths type-stable and simple.** Consistent types and small methods are what the optimizing tier rewards.
- **Plan for warmup in deploys.** If a fresh process is slow, consider sending it some traffic to warm up before it serves real users, or rolling deploys so not everything is cold at once. (Deeper strategies are in `professional.md`.)
- **Don't fight the JIT with clever code.** Obscure "fast" tricks often *defeat* the JIT (they confuse its assumptions). Clear, idiomatic code usually optimizes better than clever code.

---

## Edge Cases & Pitfalls

**Pitfall 1 — Benchmarking a single call.** Calling a function once and timing it measures the interpreter, not the JIT. Always warm up. (See Example 5.)

**Pitfall 2 — Dead-code elimination eating your benchmark.** If your benchmark computes a result and never uses it, the JIT may legally *delete the whole computation* and report an impossibly fast time. Always consume the result (print it, accumulate it, return it). This is the single most common reason a microbenchmark reports "0 ms."

**Pitfall 3 — Thinking warmup is a bug.** It is not. It is the JIT doing its job. The "bug" is usually a benchmark that measured the wrong phase, or a deployment that did not account for cold starts.

**Pitfall 4 — Believing "compiled = always faster."** A method only gets compiled if the runtime decides it is hot. Cold methods stay interpreted *on purpose*, and that is correct. Not every line of your program runs as native code.

**Pitfall 5 — Mixing types on a hot path.** A loop that processes a list of mixed types prevents the JIT from specializing and silently runs slower. This is invisible in the source; only profiling or trace flags reveal it. (The deeper version — "megamorphic call sites" — is covered in `senior.md`.)

**Pitfall 6 — Restarting under load.** Restarting a JIT-based service drops all its warm, compiled code. If you restart every instance at once under heavy traffic, the whole fleet is cold and slow simultaneously — a self-inflicted outage. Roll restarts.

**Pitfall 7 — Assuming the first run reflects the program.** Profilers, demos, and "quick tests" that run once show you cold numbers. Real behavior emerges only after the program has run for a while.

---

## Summary

- Managed languages (Java, JavaScript, C#) start by **interpreting** bytecode — portable but slow.
- A **JIT compiler** watches the program run, finds **hot** code via **counters**, and compiles it to **machine code** on the fly.
- A JIT can **beat an AOT compiler** because it optimizes for what the program *actually* does, using runtime **profiling data** the AOT compiler never had.
- **Tiered compilation** uses a fast-but-rough compiler first (good startup) and a slow-but-excellent compiler later for the hottest code (good steady-state speed).
- **On-Stack Replacement (OSR)** upgrades a long-running loop to compiled code without stopping it.
- **Warmup** — slow at first, fast later — is normal and expected; it is the cost of the JIT's bargain. Short-lived programs may quit before warmup pays off, which is why AOT exists.
- Practically: warm up before benchmarking, consume your benchmark results, keep hot paths type-stable and small, trust the defaults, and plan for cold starts in production.

---

## Further Reading

- The Java HotSpot virtual machine documentation on tiered compilation and the `-XX:+PrintCompilation` flag.
- V8's blog posts on Ignition (the interpreter) and the optimizing pipeline.
- "The Java Performance Companion" and "Optimizing Java" for practical warmup and benchmarking guidance.
- JMH (Java Microbenchmark Harness) documentation — the canonical explanation of why naive benchmarks lie.
- The middle, senior, and professional tiers of this topic, which go from "what the JIT does" to "how the tiers really work," "which optimizations it applies," and "how to run it in production."
