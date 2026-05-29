# Debugging — Junior Level

> **Topic:** [Debugging Roadmap](README.md)
> **Focus:** What debugging really is. Reading errors. Print debugging done right. First steps with `pdb`, `dlv`, Node `--inspect`. The systematic loop: reproduce → narrow → hypothesize → test → fix.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [The First Toolkit](#the-first-toolkit)
8. [Code Examples](#code-examples)
9. [Pros & Cons of Print vs Debugger](#pros--cons-of-print-vs-debugger)
10. [Use Cases](#use-cases)
11. [Coding Patterns](#coding-patterns)
12. [Clean Code](#clean-code)
13. [Best Practices](#best-practices)
14. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
15. [Common Mistakes](#common-mistakes)
16. [Tricky Points](#tricky-points)
17. [Test Yourself](#test-yourself)
18. [Tricky Questions](#tricky-questions)
19. [Cheat Sheet](#cheat-sheet)
20. [Summary](#summary)
21. [What You Can Build](#what-you-can-build)
22. [Further Reading](#further-reading)
23. [Related Topics](#related-topics)
24. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **What is debugging, really?** and **What does a beginner do on day one when something breaks?**

**Debugging is not the act of making the symptom go away.** It is the act of finding the *cause* of a discrepancy between what your program does and what you thought it did. The symptom is the smoke; the bug is the fire. Smothering the smoke (`try/except: pass`, deleting the failing test, adding a `// TODO: figure out later`) does not put the fire out — it just hides it until something more expensive burns down.

If writing code is a conversation with the machine, debugging is the part where the machine says *"that's not what you actually told me to do"* — and you have to figure out which one of you misunderstood. Almost always, it was you. The machine, as the old saying goes, **is not lying**.

This page is your first map. We'll cover what to do in the first ten minutes after something breaks: read the error properly, reproduce it locally, reduce it to the smallest example that still fails, and then either drop a few well-chosen `print` statements or open an interactive debugger. We'll meet `pdb` (Python), `dlv` (Go), Node's `--inspect-brk`, and IntelliJ's GUI debugger. The next level (`middle.md`) covers conditional breakpoints, watchpoints, and remote debugging. `senior.md` covers production debugging, core dumps, and live tracing.

> 🎓 **Why this matters for a junior:** Senior engineers are not faster typists or better memorizers. They are faster *debuggers*. The gap between a two-hour bug hunt and a six-hour one almost never comes from raw intelligence — it comes from *method*. Learning the method early is the cheapest leverage you will ever buy.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to write and run a small program in at least one language (Go, Python, Java, JavaScript).
- **Required:** What a function call and a return value are.
- **Required:** How to read code and follow what it does line by line.
- **Helpful:** What a *call stack* is — that `main` calls `processOrder`, which calls `loadCustomer`, which calls `queryDB`. The stack trace is literally a snapshot of this.
- **Helpful:** Exposure to error handling basics. See [`../error-handling/junior.md`](../error-handling/junior.md). If you cannot read an error message, you cannot debug.
- **Helpful:** A code editor or IDE that has a debugger (VS Code, IntelliJ, PyCharm, GoLand). Yes, even your terminal-only debugger journey will be easier if you've seen what breakpoints look like in a GUI.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Bug** | A defect in your code — the program does something it shouldn't, or doesn't do something it should. |
| **Defect** | A formal synonym for bug. You'll see it in test reports and academic papers. |
| **Symptom** | The visible misbehavior — a crash, a wrong number, a hung process. *Not* the bug itself. |
| **Root cause** | The actual broken thing in the code or environment that produces the symptom. |
| **Reproduce / Repro** | To make the bug happen on demand. The most important skill in debugging. |
| **Minimum reproducible example (MRE)** | The smallest program that still triggers the bug. The "kill it with fire" form of a repro. |
| **Stack trace** | The list of nested function calls active at the moment something failed. Usually printed from innermost (where the failure happened) to outermost (`main`), or the other way around depending on language. |
| **Frame** | One entry in a stack trace. Represents one function call in progress. |
| **Innermost frame** | The frame where the actual error happened — usually the first or last line of the trace, depending on the language. |
| **Breakpoint** | A marker that pauses the program at a chosen line so you can inspect it. |
| **Step over** | Run the current line as a single unit and stop on the next line of the same function. |
| **Step into** | If the current line is a function call, descend into that function. |
| **Step out** | Run until the current function returns, then stop. |
| **Watch** | A debugger feature: continuously evaluate an expression and show its value as you step. |
| **Print debugging** | Inserting `print`/`println`/`fmt.Println`/`console.log` statements to inspect program state at runtime. |
| **Rubber duck debugging** | Explaining your problem out loud to an inanimate object (or a non-developer); often the act of articulating the problem reveals the answer. |
| **Heisenbug** | A bug that disappears or changes behavior when you try to observe it. (Senior topic — mentioned for vocabulary.) |
| **Regression** | A bug that re-appears after being "fixed." Often a sign the original fix masked rather than removed the bug. |
| **It works on my machine** | An anti-pattern — claiming a bug doesn't exist because you can't reproduce it locally. Treat this phrase as a warning, not a defense. |

---

## Core Concepts

### 1. Debugging Is Finding the Cause, Not Killing the Symptom

The most common mistake juniors make is treating debugging as "make the red error stop appearing." That's not the goal. The goal is to understand *why* it appeared. If you stop too early, you fix the *appearance* of the bug but leave the *cause* in the code — where it will rot, mutate, and resurface somewhere worse three weeks from now.

A useful test: *"If I had to explain this fix to a thoughtful colleague in one sentence, could I say what was wrong, why it was wrong, and why my change makes it right?"* If the answer is *"the error went away,"* you haven't debugged. You've sedated.

### 2. The Computer Is Not Lying

When the output of your program looks impossible — *"there's no way this could happen, this code is correct"* — the bug is almost always in **your model of the code**, not in the code itself. The CPU is not skipping `if` statements. The compiler is not silently reversing your conditions. The database is not randomly losing rows.

What is much more likely is that one of your assumptions — about the input, the call order, the value of a variable, the version of a library — is wrong. The debugger's first job is to **make assumptions visible** so you can see which one snapped.

### 3. Reproduce Before You Diagnose

You cannot reliably fix a bug you cannot reliably trigger. A bug you've seen once and can't reproduce is **not a fixable bug yet** — it's a sighting. Step zero of any debugging session is: *"Can I make this happen on demand?"*

If yes: cut everything around it until you have the smallest repro that still fails.
If no: collect more information (logs, stack traces, environment data) until you can.

### 4. Change One Thing at a Time

When you're trying to identify which line, config, or dependency causes the bug, change **one variable** between runs. Two simultaneous changes that fix the bug tell you nothing about which one mattered — and the one that didn't matter may have introduced a new bug you'll find next week.

### 5. The Stack Trace Is Your Best Friend, Not Wallpaper

Beginners scroll past stack traces. Seniors read them line by line. The stack trace tells you exactly which function was running when the error happened, and which function called it, and which called that one. It is a *free*, *accurate*, *machine-generated* explanation of the path your program took. Refusing to read it is like getting a treasure map and throwing it away.

### 6. Reading the Error Message Costs Nothing

Most error messages in modern languages are written by experienced engineers and tell you, in plain English, what went wrong. The phrase *"I can't figure out this bug"* often turns into *"oh, the error literally says what's wrong"* the moment someone forces you to read it slowly.

### 7. The Bug Lifecycle

Every bug, from a one-line typo to a three-day production outage, follows the same loop:

```text
detect → reproduce → narrow → hypothesize → test → fix → regression-test
```

Skipping a step doesn't make you faster. It makes you wrong faster.

---

## Real-World Analogies

| Concept | Real-World Analogy |
|---|---|
| **Bug** | A leaky pipe behind a wall — you see water on the floor (symptom), but the hole is somewhere else (cause). |
| **Symptom vs root cause** | Mopping the floor doesn't stop the leak. |
| **Reproduce** | A doctor needs to see the rash to diagnose it. "It comes and goes" is not enough; bring a photo. |
| **Minimum reproducible example** | A scientist isolates one variable at a time. You cannot diagnose a recipe by re-cooking the whole meal — change one ingredient. |
| **Stack trace** | A flight black box — records exactly which calls happened in what order, so post-crash investigators can retrace the path. |
| **Print debugging** | Sticking GPS pingers on a missing dog at known waypoints. |
| **Breakpoint** | A pause button on a movie. Frame-by-frame inspection. |
| **Step over vs step into** | "Watch this scene normally" vs "let me look at every character's lines during this scene." |
| **Rubber duck debugging** | Writing a clear question on Stack Overflow often produces the answer before you press Submit. |
| **Heisenbug** | A noise in your car that stops the moment you take it to the mechanic. |
| **"It works on my machine"** | "The patient's symptoms went away in the waiting room." Still sick; just shy. |

---

## Mental Models

### 1. Debugging Is Binary Search Over Suspicion

You start with the whole codebase under suspicion. Every successful experiment — a print that shows a known-good value, a passing assertion, a function call that returns the right thing — eliminates half (or more) of the haystack. Every failed experiment narrows the search to the other half. The number of well-chosen experiments needed to find a bug grows *logarithmically* with the size of the codebase, not linearly. The art is choosing experiments that split the space.

### 2. The Bug Is a Difference Between Two Models

You hold a mental model of what the code does. The code holds an actual behavior. A bug exists where these two diverge. Debugging is the act of finding the divergence point — the first line where your prediction stops matching reality.

So the debugger's question is always: *"Where does what I expect first stop matching what is?"* Print, breakpoint, or log values at points along the execution and look for the first one that surprises you. **The bug lives one step earlier.**

### 3. Reading Code Top-Down, Reading Errors Bottom-Up

You write code top-down: from the high-level function to the helpers it calls. You read errors bottom-up: the innermost frame is where things actually went wrong; the outer frames are just *how you got there*. Different reading directions for different jobs.

### 4. Print Debugging Is Not Beneath You

There is a folk belief that "real" engineers use debuggers and "beginners" use prints. This is nonsense. Seniors at Google, Microsoft, and the Linux kernel use `printf` constantly because in many situations — async hot paths, distributed systems, production servers — *you cannot pause the program*. Prints are sometimes the *only* tool. The skill is choosing the right one for the job.

---

## The First Toolkit

Your day-one toolkit is small. You don't need ten years of tools to debug an error message.

1. **Read the error.** Slowly. Every word.
2. **Read the stack trace from the innermost frame outward** until you hit your own code.
3. **Reproduce locally** — run the failing test, the failing CLI call, the failing HTTP request.
4. **Shrink the repro** — delete code, hard-code inputs, until the smallest version that still fails remains.
5. **Add prints** at the boundaries of suspect functions to see what's going in and what's coming out.
6. **Or set a breakpoint** and step through with a real debugger.
7. **Form one hypothesis at a time**, test it, accept or reject it, then form the next.
8. **Once fixed, write a test** that would have caught it. This is the regression test — your insurance policy against the bug coming back.

That's the whole loop. Everything else in this roadmap is depth on individual steps.

---

## Code Examples

The examples below all use the same family of bugs so you can compare how each language reports and how each debugger reacts.

### Example 1 — A `loadConfig()` that fails silently (and a print rescues it)

#### Python

```python
# config_loader.py
import json
from pathlib import Path

def load_config(path: str) -> dict:
    try:
        return json.loads(Path(path).read_text())
    except Exception:
        # BAD: silent failure — empty dict masks the real error.
        return {}

def get_timeout(config: dict) -> int:
    return config.get("timeout", 30)

if __name__ == "__main__":
    cfg = load_config("conifg.json")  # typo: "conifg" not "config"
    print(f"Using timeout: {get_timeout(cfg)}s")
```

Run it: `Using timeout: 30s`. Looks fine. But your real config file said `timeout = 5`. The bug: `load_config` swallowed the `FileNotFoundError` and returned `{}`, so the fallback `30` was used.

**Fix with a print, then with a real fix:**

```python
def load_config(path: str) -> dict:
    try:
        return json.loads(Path(path).read_text())
    except Exception as e:
        print(f"[DEBUG load_config] failed to read {path!r}: {e}")  # diagnostic
        return {}
```

Now: `[DEBUG load_config] failed to read 'conifg.json': [Errno 2] No such file or directory`. The bug is now visible. The *proper* fix is to **let the exception propagate** instead of swallowing it. See [`../error-handling/junior.md`](../error-handling/junior.md).

#### Go

```go
// config_loader.go
package main

import (
	"encoding/json"
	"fmt"
	"os"
)

type Config struct {
	Timeout int `json:"timeout"`
}

func loadConfig(path string) Config {
	data, err := os.ReadFile(path)
	if err != nil {
		// BAD: silent failure
		return Config{}
	}
	var c Config
	_ = json.Unmarshal(data, &c)
	return c
}

func main() {
	cfg := loadConfig("conifg.json")
	if cfg.Timeout == 0 {
		cfg.Timeout = 30
	}
	fmt.Printf("Using timeout: %ds\n", cfg.Timeout)
}
```

Same bug, same fix family — add an error print at the failure point, then redesign so the error propagates:

```go
func loadConfig(path string) (Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Config{}, fmt.Errorf("loadConfig: %w", err)
	}
	var c Config
	if err := json.Unmarshal(data, &c); err != nil {
		return Config{}, fmt.Errorf("loadConfig: parse: %w", err)
	}
	return c, nil
}
```

#### JavaScript (Node.js)

```js
// config_loader.js
const fs = require("fs");

function loadConfig(path) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (e) {
    // BAD: silent failure
    return {};
  }
}

const cfg = loadConfig("conifg.json");
console.log(`Using timeout: ${cfg.timeout ?? 30}s`);
```

The "real fix" version: don't `try/catch` at all unless you have something useful to do — let the failure crash the program early, with a real stack trace.

---

### Example 2 — A `divide_by_zero` deep in a call chain (read the stack trace)

#### Python

```python
def average(nums):
    return sum(nums) / len(nums)

def report_for_user(user_id, records):
    user_records = [r for r in records if r["user_id"] == user_id]
    return average([r["score"] for r in user_records])

def daily_report(records):
    user_ids = {r["user_id"] for r in records}
    return {uid: report_for_user(uid, records) for uid in user_ids}

if __name__ == "__main__":
    records = [
        {"user_id": 1, "score": 80},
        {"user_id": 2, "score": 70},
    ]
    daily_report(records + [{"user_id": 3, "score": 0}])  # user 3 exists
    # But what if a request asks for user 99?
    report_for_user(99, records)
```

Stack trace:

```text
Traceback (most recent call last):
  File "report.py", line 18, in <module>
    report_for_user(99, records)
  File "report.py", line 6, in report_for_user
    return average([r["score"] for r in user_records])
  File "report.py", line 2, in average
    return sum(nums) / len(nums)
ZeroDivisionError: division by zero
```

**Read it bottom up:** `ZeroDivisionError` — division by zero — at `average()`'s `sum(nums) / len(nums)`. So `len(nums)` was 0. Who called `average` with an empty list? Line above: `report_for_user`. Why was `user_records` empty? Outer frame: the call was `report_for_user(99, records)` and no record has `user_id == 99`. **Bug found.** Fix: guard `average` against empty input, or filter to known users in `report_for_user`.

#### Go

```go
package main

import "fmt"

func average(nums []float64) float64 {
	var s float64
	for _, n := range nums {
		s += n
	}
	return s / float64(len(nums))
}

func reportForUser(userID int, records []Record) float64 {
	var scores []float64
	for _, r := range records {
		if r.UserID == userID {
			scores = append(scores, r.Score)
		}
	}
	return average(scores)
}

type Record struct {
	UserID int
	Score  float64
}

func main() {
	records := []Record{{1, 80}, {2, 70}}
	fmt.Println(reportForUser(99, records))
}
```

Go division of a float64 by zero produces `+Inf` or `NaN` rather than crashing — *which is worse for debugging*, because there's no stack trace. The bug becomes a silent `NaN` that pollutes downstream computations. Always guard against empty input explicitly.

#### Java

```java
public class Report {
    static double average(double[] nums) {
        double sum = 0;
        for (double n : nums) sum += n;
        return sum / nums.length;
    }

    public static void main(String[] args) {
        double[] empty = new double[0];
        System.out.println(average(empty)); // NaN, no crash
        int[] ints = new int[0];
        // But:
        int total = 0;
        System.out.println(total / ints.length); // ArithmeticException
    }
}
```

Java integer division by zero throws `ArithmeticException` with a stack trace; floating-point division returns `NaN` silently. **Lesson:** the language's behavior on a divide-by-zero depends on whether you're in `int` land or `float`/`double` land. Knowing this saves you hours.

---

### Example 3 — Setting a breakpoint in `pdb`, `dlv`, and Node Inspector

Same bug, same fix experience, three debuggers.

#### Python — `pdb`

Drop a `breakpoint()` call (Python 3.7+). When execution hits it, you get an interactive prompt.

```python
def report_for_user(user_id, records):
    user_records = [r for r in records if r["user_id"] == user_id]
    breakpoint()  # <-- pauses here
    return average([r["score"] for r in user_records])
```

```text
> report.py(6)report_for_user()
-> return average([r["score"] for r in user_records])
(Pdb) p user_id
99
(Pdb) p len(user_records)
0
(Pdb) p [r["user_id"] for r in records]
[1, 2]
(Pdb) c   # continue
```

Common `pdb` commands:

| Command | What it does |
|---|---|
| `n` (next) | Step over the current line |
| `s` (step) | Step into a function call |
| `r` (return) | Run until the current function returns |
| `c` (continue) | Resume until the next breakpoint |
| `p <expr>` | Print the value of an expression |
| `pp <expr>` | Pretty-print |
| `l` (list) | Show source around the current line |
| `bt` / `where` | Show the call stack |
| `q` | Quit the debugger |

#### Go — `dlv`

```bash
$ dlv debug ./report.go
(dlv) break report.go:14    # reportForUser
Breakpoint 1 set at 0x... for main.reportForUser() ./report.go:14
(dlv) continue
> main.reportForUser() ./report.go:14
(dlv) print userID
99
(dlv) print records
[]main.Record len: 2, cap: 2, [...]
(dlv) next
(dlv) print scores
[]float64 len: 0, cap: 0, []
```

Common `dlv` commands:

| Command | What it does |
|---|---|
| `break <file:line>` | Set a breakpoint |
| `continue` (`c`) | Resume |
| `next` (`n`) | Step over |
| `step` (`s`) | Step into |
| `stepout` (`so`) | Step out |
| `print <expr>` (`p`) | Print a value |
| `locals` | Print all local variables |
| `args` | Print all function arguments |
| `stack` (`bt`) | Show the call stack |
| `goroutines` | Show all goroutines (huge in concurrent Go) |

#### JavaScript — Node `--inspect-brk`

```bash
node --inspect-brk report.js
```

Then open `chrome://inspect` in Chrome and click "inspect." You get a full DevTools UI: breakpoints by clicking the gutter, hover variables to see values, a call stack panel on the right, a watch panel for arbitrary expressions.

Or in VS Code, add this to `.vscode/launch.json`:

```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug report",
  "program": "${workspaceFolder}/report.js",
  "stopOnEntry": true
}
```

Then press F5 and click the gutter to set breakpoints.

---

### Example 4 — A "wrong line number" trick (the error blames the wrong line)

Sometimes the line the error points at is not the line with the bug. Beginners spend hours staring at a correct line.

#### JavaScript trailing-comma confusion in older runtimes

```js
const config = {
  host: "localhost",
  port: 3000,
  debug: true,
}  // SyntaxError reported here in older parsers
const start = require("./server");
start(config);
```

Old parsers reported the `SyntaxError` on the `const start` line — even though the actual problem (in some environments) was a stray character earlier in the file. **Lesson:** when the line looks innocent, look at the line *just before* it. Parser errors are often delayed by one token.

#### Python — wrong line on an unterminated string

```python
greeting = "Hello, world
print(greeting)
```

Python reports the error on the `print` line, not the line with the missing quote, because the lexer keeps consuming text until end of file or the next quote. The fix is on the line above.

#### Go — wrong line on a missing import

```go
package main

func main() {
	fmt.Println("hello")
}
```

The compiler points at `func main()` with `undefined: fmt`. The real fix is in the missing `import "fmt"`. **Lesson:** "undefined" errors usually mean a missing import or typo, not a missing function definition. Look up, not down.

---

## Pros & Cons of Print vs Debugger

| Approach | Pros | Cons |
|---|---|---|
| **Print debugging** | Works everywhere — CI, production, embedded, multi-process. No tool setup. Survives in async/concurrent code where debuggers struggle. | Adds noise. Easy to forget and commit. No interactive exploration — you only see what you printed. |
| **Interactive debugger** | Pause anywhere. Inspect any variable. Step line-by-line. See the live call stack and goroutines/threads. Modify variables on the fly. | Setup cost. Doesn't work well in async/distributed/production. Slows down some bugs (Heisenbugs). |
| **Logging** | Persistent. Searchable. Production-safe with levels. See [`../logging/junior.md`](../logging/junior.md). | Requires forethought; doesn't help with "I have no log for this." |
| **Stack trace alone** | Free, automatic, accurate. Usually solves 30% of bugs by itself. | Useless when the symptom isn't a crash. |
| **Rubber duck** | Costs nothing, often instant. Surfaces hidden assumptions. | Doesn't tell you anything new — only what you already half-knew. |

The honest rule: **use whichever surfaces the bug fastest.** A senior moves between all of them within a single debugging session.

---

## Use Cases

| Situation | Likely best first tool |
|---|---|
| You have a crash with a stack trace. | Read the stack trace. Then breakpoint or print at the innermost frame. |
| Output is wrong but no error. | Print at boundaries to find where it first diverges from expected. |
| A test fails. | Run the test in isolation with the debugger. Use `pytest -x --pdb` (Python), `dlv test` (Go), VS Code's "Debug test" button. |
| The bug only appears in production. | Add structured logs and ship. Try to reproduce locally with the production input. See `senior.md`. |
| Concurrent / race bug. | Use the race detector (`go test -race`, Java's `ThreadSanitizer`-like tools). Debuggers can hide the bug. |
| A library is doing something unexpected. | Step *into* the library code with the debugger. Verify your assumptions. |
| You don't even know where to start. | Set a breakpoint at the top of `main` (or the test) and step through, watching the variables you don't trust. |

---

## Coding Patterns

### Pattern 1 — The Tagged Diagnostic Print

```python
print(f"[DEBUG load_config] path={path!r} result_keys={list(result)}")
```

- **Tag** with the function name so prints don't get lost.
- **Show the variable name**, not just the value: `path={path!r}` is far easier to scan than just printing the value.
- Use `repr` / `{!r}` / `%q` / `JSON.stringify` so strings with whitespace are visible.

### Pattern 2 — Binary Search With Prints

You suspect the bug is somewhere in a 200-line function. You don't know where. Instead of reading top-to-bottom, drop **one** print at line 100. Did the value print? Bug is after line 100. No? Bug is before. Repeat with line 50 or 150. Halve every time.

Eight prints can localize a bug in a 256-line function. Ten prints can localize one in a 1024-line function. This is *exactly* `log2(N)`.

### Pattern 3 — Bracketing the Boundary

```python
print(">>> enter loadConfig", {"path": path})
result = json.loads(Path(path).read_text())
print("<<< exit loadConfig", {"keys": list(result)})
```

The `>>>` / `<<<` makes it visually obvious which call is which when there are many in a row, and makes it easy to grep them out before committing.

### Pattern 4 — The Sanity Assertion

Sometimes you don't print — you *assert*.

```go
if len(users) == 0 {
	panic("invariant violated: users must be non-empty here")
}
```

If your assumption is right, the assertion is invisible. If it's wrong, you get an immediate, loud crash at the exact line the assumption broke — a free diagnostic.

### Pattern 5 — The MRE (Minimum Reproducible Example)

A bug report — to yourself, your team, or a library author — is N times more useful if it's a 20-line script that reproduces the bug. Build one. Often, the *act* of building the MRE reveals the bug.

---

## Clean Code

- Remove diagnostic prints **before commit.** A `print("here1")` left in production is a code smell visible from orbit. Use `git diff` before staging.
- Prefer `logging.debug` over `print` if the project already has a logger — debug-level logs can be left in and turned off in production.
- Name temporary variables `_dbg_xxx` if you must keep them so they're easy to grep and delete.
- Never write `try/except: pass` to "fix" a bug. That is a cover-up. Either handle the exception meaningfully or let it propagate.
- If you must temporarily comment out code while debugging, write `// TODO: re-enable, debugging XXX` so you can grep for it later.
- One commit per bug fix. Don't bundle a fix with refactoring or new features — it makes future bisecting impossible.

---

## Best Practices

1. **Read the error message before doing anything else.** Most beginners "skim and panic." Read it twice. Look up unfamiliar words.
2. **Always reproduce locally before changing code.** If you can't reproduce, the first task is to *make* a reproduction, not to start guessing.
3. **Form one hypothesis at a time.** Write it down: *"I think X. If true, then Y should be Z. Let me check."*
4. **Change one thing per experiment.** Two changes at once = no information.
5. **Use version control as a debugger.** `git bisect` can find which commit introduced a bug across thousands of commits in a few iterations.
6. **Write a regression test for every bug you fix.** It locks the door behind you.
7. **Time-box your initial attack.** If 30 minutes of solo debugging hasn't found it, *talk to a person* or step away. Tunnel vision is the silent killer of debug time.
8. **Keep a debugging notebook.** Real one or text file. Capture symptoms, hypotheses, experiments, results. You will reuse this on the next bug — or the next time *this* bug almost comes back.

---

## Edge Cases & Pitfalls

- **Different line endings** between editors (`\r\n` vs `\n`) can produce confusing diff output and "I didn't change this line" claims.
- **Caching:** the file you're editing is not the file being run (`__pycache__`, build artifacts, hot-reload not picking up changes). Always verify by deleting caches or printing a known string.
- **Multiple Python interpreters / Node versions** on the same machine. Run `which python`, `python --version` inside the venv to be sure.
- **Optimized builds** strip debug symbols and inline functions, making stepping unreliable. Build with `-g` (C/C++/Go via `go build -gcflags="all=-N -l"`) for debugging.
- **Time zones, locales, and decimal separators** are a perennial source of "impossible" bugs.
- **Floating-point comparison** with `==` is almost always wrong. `0.1 + 0.2 == 0.3` is `False` in every common language.
- **Mutable default arguments in Python** (`def f(x, items=[])`) — the default is shared across calls. Famous beginner trap.
- **JavaScript `==` vs `===`** — `"0" == false` is true. Always use `===`.

---

## Common Mistakes

1. **Not reading the error message.** Look at it, slowly, before doing anything else. A staggering fraction of "I'm stuck" debugging sessions end with "oh, the error literally told me."
2. **Reproducing by running the whole app.** Don't replay a 30-step QA scenario when a 10-line script would do.
3. **Cargo-cult debugging.** Randomly changing code, restarting, deleting `node_modules` and reinstalling — hoping the bug goes away. It might. The cause remains.
4. **Adding `try/except: pass` to "fix" an exception.** This is sedation, not surgery. The bug is now invisible *and* unfixed.
5. **Believing the line number blindly.** Especially for syntax errors and "wrong line" parser bugs. Look one line above or below.
6. **Trusting "it works on my machine" as evidence the bug doesn't exist.** It means *you can't reproduce it yet*, not that it isn't real.
7. **Changing two things at once.** You'll learn nothing if it works and nothing if it doesn't.
8. **Forgetting to remove diagnostic prints before commit.** A `print("AAAAA")` in main is forever embarrassing.
9. **Re-running without re-reading.** Re-running a flaky test ten times does not debug it. *Read it* and find the source of non-determinism.
10. **Not writing a regression test.** The bug *will* come back without one.
11. **Confusing the symptom with the cause.** "It crashes on line 42" is the symptom. "We never validated user input upstream" is the cause.
12. **Reading the stack trace top to bottom in Python instead of bottom to top.** The bottom is where the error happened; the top is just `main`. (Go and Java vary — know the direction your language uses.)

---

## Tricky Points

1. **The stack trace direction differs by language.** Python and JavaScript print *most recent call last* (read bottom up). Java and Go typically print *most recent call first* (read top down). Always check which way you're reading.
2. **The "innermost frame" is not always your code.** The bug might be in a library — but more often, the library is fine and the bug is in your code one frame up, where you called the library with bad arguments. Walk *up* the trace until you reach your own code, then look there first.
3. **"Caused by:" chains in Java.** A Java exception can wrap another. You'll see a chain: `XyzException ... Caused by: AbcException ... Caused by: IOException ...`. The root cause is the *deepest* `Caused by:`. Read all the way down before forming a hypothesis.
4. **Python's "during handling of the above exception, another exception occurred."** This is Python telling you that while handling exception A, another exception B was raised. Read both; the *first* one (A) is usually the original problem.
5. **Some bugs only appear in optimized / release builds.** Race conditions, uninitialized memory, ordering bugs. Don't assume "works in debug" means "works."
6. **A debugger can change behavior.** Setting a breakpoint pauses threads — sometimes hiding the race you were trying to find. This is a *heisenbug* (senior topic).
7. **`print` itself can change behavior** in I/O-heavy code: writes flush stdout, which is synchronous, which can mask race conditions or change timing.
8. **`print` ordering is not guaranteed across threads/goroutines** — interleaved output can look impossible. Add timestamps or use a single logger.
9. **A passing test after your fix doesn't prove correctness.** It just proves the fix didn't break *that* test. Add a new test that *would have failed* before the fix.
10. **The bug is usually in the code you're certain is right.** When you find yourself saying "but that code is correct, I checked it," check it again with prints. That's where the bug is hiding.

---

## Test Yourself

Work through these. No answers — they're for your own honest assessment.

1. Take a working program of yours. Introduce a subtle bug (off-by-one, swapped variables, missing guard). Hand the broken version to a friend. Time how long they take to find the bug. Then have them do the same to you.
2. Read the most recent stack trace from any project you work on. Identify the innermost frame, the outermost frame, and the first frame that is *your* code (not the framework or stdlib).
3. Open `pdb`, `dlv`, or your IDE's debugger. Set a breakpoint inside a `for` loop. Step through three iterations. Print the loop variable at each step.
4. Write a 10-line repro of a real bug from your last project. If you can't, the bug isn't well understood yet.
5. Take a slow-feeling test in your project. Add prints around it to find where the time is spent. *You're now debugging performance with prints — same skill, different question.*
6. Practice `git bisect` on a repo with 20+ commits. Intentionally introduce a bug ten commits ago. See how few iterations bisect takes to find it.
7. Force yourself to articulate (out loud, to a duck, in a Slack draft message you don't send) what the bug is. Stop after one paragraph. Do you understand it? If not, debug some more.
8. Find an open-source project's bug tracker. Read a bug report and its fix commit. Try to predict the fix before you read it. Were you right?

---

## Tricky Questions

**Q1: A function returns the wrong value, but you've checked the function and the code is correct. Where do you look next?**

At the *caller*. A function "returning the wrong value" almost always means it was called with arguments you didn't expect. Print or breakpoint at the call site and inspect what's actually being passed in. If the inputs are wrong, the output will be wrong — and the function is innocent.

**Q2: The same code works on your laptop and fails on the CI server. What are the top three causes to check?**

(a) Different language/library versions. (b) Different environment variables, secrets, or config files present locally but not on CI. (c) Different working directory or filesystem state (cached files, prebuilt artifacts). Run `env`, version flags, and a directory listing in CI to find the asymmetry.

**Q3: A bug occurs only when the program is run with `--verbose`. The verbose flag only adds logging. What's likely happening?**

The added log statements change *timing*. You probably have a race condition that's masked by the extra I/O. The logging is not the cause; it's the catalyst. Look for shared mutable state and missing synchronization.

**Q4: Why is `try/except: pass` (or Go's `_ = err`) almost always a bug?**

Because it silently turns an unknown failure into a wrong-looking success. The program continues with bad data, the failure shows up later somewhere unrelated, and the *original* cause is unrecoverable. Either handle the error meaningfully or let it propagate.

**Q5: The stack trace points at a line in a third-party library. Is the bug in the library?**

Probably not. The *more likely* cause is that your code is calling the library incorrectly. Walk up the stack trace until you reach your own code; that's where the bug usually lives. Only after you've ruled out caller error should you suspect a real library bug.

**Q6: You introduce a fix. The failing test now passes. You're done — or not?**

Not done until: (1) you can explain in one sentence what was wrong and why your change fixes it; (2) you've added a regression test that would have *failed before the fix*; (3) you've checked nothing else broke (run the rest of the suite); (4) the diagnostic prints are gone.

**Q7: Print debugging vs an interactive debugger — which is "better"?**

Neither. They solve different problems. Use a debugger when you can pause the process; use prints when you can't (production, async, distributed). Seniors switch between them within a single session.

**Q8: A test is "flaky" — sometimes passes, sometimes fails. What is the first thing to do?**

Do *not* re-run it ten times and call it green. Find the source of non-determinism. Common culprits: time, random numbers, network calls, ordering of map/dict iteration, concurrent goroutines/threads, shared global state. Eliminating non-determinism is real debugging — ignoring flakes is technical debt accruing interest.

---

## Cheat Sheet

```text
┌──────────────────────────────── DEBUGGING — JUNIOR CHEAT SHEET ─────────────────────────────────┐
│                                                                                                 │
│  STEP-BY-STEP LOOP                                                                              │
│    1. READ the error message.    Word by word.                                                  │
│    2. READ the stack trace.      Innermost frame outward.                                       │
│    3. REPRODUCE locally.         Smallest input that triggers it.                               │
│    4. SHRINK to minimum repro.   Delete what doesn't matter.                                    │
│    5. HYPOTHESIZE one thing.     "If X, then Y should be Z."                                    │
│    6. TEST the hypothesis.       Print, breakpoint, or assertion.                               │
│    7. CHANGE one thing.          Re-test. Accept or reject.                                     │
│    8. FIX.                       Then write a regression test.                                  │
│                                                                                                 │
│  STACK TRACE READING                                                                            │
│    Python / JS  → bottom-up    (last printed = where it happened)                               │
│    Go / Java    → top-down     (first printed = where it happened)                              │
│    Innermost = the bug's neighborhood. Outermost = main / entry point.                          │
│    Walk up until you reach YOUR code.                                                           │
│                                                                                                 │
│  FIRST-AID DEBUGGER COMMANDS                                                                    │
│    pdb (Python):   n  s  c  p <x>  l  bt  q                                                     │
│    dlv (Go):       break  continue  next  step  print  locals  stack  goroutines                │
│    Node:           node --inspect-brk app.js  → chrome://inspect                                │
│    IDE (any):      F9 toggle break, F5 run, F10 step over, F11 step into, Shift+F11 step out    │
│                                                                                                 │
│  RED FLAGS                                                                                      │
│    try/except: pass     →  cover-up, not fix                                                    │
│    "It works for me"    →  unreproduced ≠ nonexistent                                           │
│    Two changes at once  →  no information learned                                               │
│    Re-run a flaky test  →  not debugging, gambling                                              │
│    Random restarts      →  cargo-cult                                                           │
│                                                                                                 │
│  GOLDEN RULES                                                                                   │
│    • The computer is not lying.                                                                 │
│    • Change one thing at a time.                                                                │
│    • The bug is where you're certain it isn't.                                                  │
│    • Symptom ≠ cause.                                                                           │
│    • If you can't explain the fix in one sentence, you haven't finished debugging.              │
│                                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- Debugging is **finding the cause**, not making the symptom disappear.
- The systematic loop: **detect → reproduce → narrow → hypothesize → test → fix → regression-test**.
- **Reading the error message and the stack trace** solves a surprising fraction of bugs for free.
- Read stack traces **bottom-up in Python/JS**, **top-down in Go/Java**. Either way, the innermost frame is where the bug fired.
- **Print debugging is not beneath seniors.** Tag your prints, include variable names, use binary search to narrow.
- The first interactive debuggers to learn: **`pdb` (`breakpoint()`)** for Python, **`dlv debug`** for Go, **Node `--inspect-brk`** for JavaScript, and your IDE's GUI debugger for everything else.
- Master the four debugger movements: **breakpoint, step-over, step-into, step-out** — and the **call stack** + **watch** panels.
- **Reproduce before you diagnose.** A bug you can't reproduce is a sighting, not a fixable bug.
- **Change one thing at a time.** Two simultaneous changes teach nothing.
- **The computer is not lying.** When the output looks impossible, the bug is in your model of the code.
- After every fix, write a **regression test** that would have failed before the fix.

---

## What You Can Build

- A "**stack-trace explainer**" CLI: paste a stack trace from Python/Go/Java/JS and the tool labels innermost frame, your-code frames vs library frames, and the `Caused by:` chain.
- A **bug journal** template (Markdown) where each entry records: symptom, repro steps, hypotheses tested, root cause, fix, regression test. Use it for two weeks; reread it; you will be visibly better.
- A **deliberately buggy mini-app** (the "broken CRUD") for friends to debug — includes a hidden silent-failure config loader, a `divide_by_zero` in an analytics function, and a mis-attributed line-number error. Practice IS the curriculum.
- A **`git bisect` driver script** that automates running your test suite on each candidate commit, so you can bisect across hundreds of commits without manual checkout.
- A small `debug_print(*args, **kwargs)` helper that prefixes timestamps and the caller's function name automatically — much nicer than naked `print`. Build it in Python and Go.

---

## Further Reading

- **Books**
  - *Debugging: The 9 Indispensable Rules for Finding Even the Most Elusive Software and Hardware Problems* — David J. Agans. The canonical "method" book. Short, dense, life-changing.
  - *Why Programs Fail: A Guide to Systematic Debugging* — Andreas Zeller. The academic counterpart, with delta debugging and bisection theory.
  - *The Pragmatic Programmer* — Hunt & Thomas, chapter on debugging.
- **Articles**
  - "Rubber Duck Debugging" — *The Pragmatic Programmer* origin story. Search any blog index.
  - Julia Evans' "Programming Zines" — especially *Bite-Size Debugging*. <https://wizardzines.com/zines/debugging/>
  - "How to Debug Small Programs" by Eric Lippert — <https://ericlippert.com/2014/03/05/how-to-debug-small-programs/>
- **Tool docs (read once, refer often)**
  - `pdb` — <https://docs.python.org/3/library/pdb.html>
  - `dlv` — <https://github.com/go-delve/delve/tree/master/Documentation/cli>
  - Node debugging — <https://nodejs.org/en/learn/getting-started/debugging>
  - VS Code debugging — <https://code.visualstudio.com/docs/editor/debugging>
- **Talks**
  - "Stop Writing Dead Programs" — Jack Rusher (Strange Loop 2022). On image-based / REPL-driven debugging.
  - "Plain Text" — Dylan Beattie. On the value of readable, greppable diagnostics.

---

## Related Topics

- **Next level up:** [middle.md](middle.md) — conditional breakpoints, watchpoints, post-mortem with core dumps, debugging tests, `git bisect`.
- **Senior level:** [senior.md](senior.md) — production debugging, distributed tracing, race detectors, debugging without pausing.
- **Professional level:** [professional.md](professional.md) — leading incident debugging, building team debugging culture, post-mortems.
- **Interview prep:** [interview.md](interview.md) — questions you'll be asked about debugging in interviews.
- **Practice problems:** [tasks.md](tasks.md) — guided exercises at each level.
- **Bug hunting:** [find-bug.md](find-bug.md) — a curated set of "find the bug" exercises.

**Sibling diagnostic topics:**

- [Error Handling — Junior](../error-handling/junior.md) — you must be able to read and reason about errors to debug them.
- [Logging — Junior](../logging/junior.md) — good logs *are* a debugging tool. Read this next.

**Cross-roadmap links:**

- [Clean Code — Error Handling](../../code-craft/clean-code/06-error-handling/README.md) — clean error handling makes future debugging cheaper.
- [Testing — Junior](../../quality-engineering/testing/README.md) — the regression test step of the bug lifecycle lives here.

---

## Diagrams & Visual Aids

### The Bug Lifecycle

```text
   ┌──────────┐      ┌────────────┐      ┌──────────┐      ┌──────────────┐
   │  DETECT  │ ───► │ REPRODUCE  │ ───► │  NARROW  │ ───► │  HYPOTHESIZE │
   └──────────┘      └────────────┘      └──────────┘      └──────────────┘
        ▲                                                          │
        │                                                          ▼
        │                                                   ┌──────────────┐
        │            ┌──────────────┐      ┌────────┐       │     TEST     │
        └─────       │   REGRESSION │ ◄─── │  FIX   │ ◄──── │ (one change) │
            no       │     TEST     │      └────────┘       └──────────────┘
                     └──────────────┘                              │
                                                                   │ refuted?
                                                                   ▼
                                                            new hypothesis
```

### Reading a Stack Trace (Python style — most recent call last)

```text
   Traceback (most recent call last):
     File "main.py", line 30, in <module>           ◄──── outermost: entry point
       run()
     File "main.py", line 20, in run
       process(orders)                              ◄──── caller
     File "main.py", line 12, in process
       send(order.customer_id)                      ◄──── inner caller
     File "main.py", line 5, in send
       client.post(url, json=body)                  ◄──── INNERMOST FRAME
   ConnectionError: name or service not known       ◄──── the actual error
```

Read it from the bottom: the error name and message → the line that triggered it → walk up to find *your* code.

### Reading a Stack Trace (Go style — most recent call first)

```text
   panic: runtime error: index out of range [3] with length 3      ◄──── error first

   goroutine 1 [running]:
   main.lookup(...)
           /app/main.go:14                                          ◄──── INNERMOST
   main.process(...)
           /app/main.go:9
   main.main()
           /app/main.go:23                                          ◄──── outermost
   exit status 2
```

Read from the top: error → innermost frame → walk down to your entry point.

### Print Debugging as Binary Search

```text
                       function (200 lines)
   ┌─────────────────────────────────────────────────────────────────┐
   │ line 1                                                          │
   │   ...                                                           │
   │ line 50   ─── print ──► value OK                                │
   │   ...                                                ▲ bug is   │
   │ line 100  ─── print ──► value OK                     │ AFTER    │
   │   ...                                                │ line 150 │
   │ line 150  ─── print ──► value WRONG ────────────┐    ▼          │
   │   ...                                           │               │
   │ line 175  ─── print ──► value WRONG          ┌──┴────────┐      │
   │ line 162  ─── print ──► value OK             │ BUG LIVES │      │
   │ line 168  ─── print ──► value WRONG          │ HERE      │      │
   │           ──── 162-167 ────────────────────► │  (range)  │      │
   │   ...                                        └───────────┘      │
   │ line 200                                                        │
   └─────────────────────────────────────────────────────────────────┘
   8 prints localize a bug in ~256 lines.  Logarithmic, not linear.
```

---
