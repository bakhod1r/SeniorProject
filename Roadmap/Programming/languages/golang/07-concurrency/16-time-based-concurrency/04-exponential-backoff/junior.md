---
layout: default
title: Junior
parent: Exponential Backoff
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/04-exponential-backoff/junior/
---

# Exponential Backoff — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Why Retry At All](#why-retry-at-all)
5. [The Naive Constant Backoff](#the-naive-constant-backoff)
6. [What Goes Wrong With Constant Backoff](#what-goes-wrong-with-constant-backoff)
7. [The Exponential Idea](#the-exponential-idea)
8. [The Formula: base times 2 to the n](#the-formula-base-times-2-to-the-n)
9. [Real-World Analogies](#real-world-analogies)
10. [Mental Models](#mental-models)
11. [Your First Working Example](#your-first-working-example)
12. [Step-by-Step Walkthrough](#step-by-step-walkthrough)
13. [Variants of the Naive Formula](#variants-of-the-naive-formula)
14. [Why You Must Cap the Delay](#why-you-must-cap-the-delay)
15. [Why You Must Cap the Number of Retries](#why-you-must-cap-the-number-of-retries)
16. [The Three Outcomes of a Retry Loop](#the-three-outcomes-of-a-retry-loop)
17. [Distinguishing Retryable from Non-Retryable Errors](#distinguishing-retryable-from-non-retryable-errors)
18. [HTTP Status Codes That Are Usually Retryable](#http-status-codes-that-usually-retryable)
19. [HTTP Status Codes That Are Not Retryable](#http-status-codes-that-are-not-retryable)
20. [The Retry-After Header](#the-retry-after-header)
21. [Idempotency: The Word You Must Learn](#idempotency-the-word-you-must-learn)
22. [Pros and Cons of Exponential Backoff](#pros-and-cons-of-exponential-backoff)
23. [Use Cases](#use-cases)
24. [Code Examples](#code-examples)
25. [Coding Patterns](#coding-patterns)
26. [Clean Code](#clean-code)
27. [Error Handling](#error-handling)
28. [Performance Tips](#performance-tips)
29. [Best Practices](#best-practices)
30. [Edge Cases and Pitfalls](#edge-cases-and-pitfalls)
31. [Common Mistakes](#common-mistakes)
32. [Common Misconceptions](#common-misconceptions)
33. [Tricky Points](#tricky-points)
34. [Test](#test)
35. [Tricky Questions](#tricky-questions)
36. [Cheat Sheet](#cheat-sheet)
37. [Self-Assessment Checklist](#self-assessment-checklist)
38. [Summary](#summary)
39. [What You Can Build](#what-you-can-build)
40. [Further Reading](#further-reading)
41. [Related Topics](#related-topics)
42. [Diagrams and Visual Aids](#diagrams-and-visual-aids)

---

## Introduction
> Focus: "Why retry, when to retry, and how do I write a `for` loop that doubles the wait each time without doing damage?"

You write a program that calls another program over the network. Sometimes the other program answers. Sometimes it does not. Sometimes the connection drops mid-call. Sometimes the server returns `503 Service Unavailable` because it is restarting. Sometimes a DNS lookup fails because a packet was lost.

You have two choices. You can give up the first time, surfacing the error to the caller of your function. Or you can try again. *Trying again* sounds simple, but it is one of the most subtly dangerous things you can do in a distributed system. Try again too fast and you make the original problem worse. Try again forever and you make the program hang. Try again at exactly the same moment every other client tries again and you cause a "thundering herd" where the recovering server is flattened by the simultaneous wave.

The discipline of retrying intelligently is called **backoff**. The two questions a backoff strategy answers are:

1. *How long do I wait before the next attempt?*
2. *When do I give up entirely?*

Exponential backoff answers the first question with a rule that grows the wait by a factor (typically 2) each time. Attempt 1 might wait 100 ms; attempt 2 waits 200 ms; attempt 3 waits 400 ms; attempt 4 waits 800 ms; and so on. The intuition is simple: if the problem is transient, a short wait is enough; if the problem is persistent, longer waits give the system time to recover *and* reduce the load you put on it.

At the junior level, that is all the math you need. Later files in this section will introduce *jitter* (randomising the wait so all clients do not retry together), *caps* (so you never wait an hour), and *budgets* (so a single user request does not retry forever). This file is about the bone-simple version: a `for` loop, a doubling delay, and a working example you can paste into a `main.go` and run.

After reading this file you will:

- Understand why retrying is sometimes the right answer and sometimes a disaster
- Know what *constant backoff* is and why it is rarely a good idea
- Know the formula `delay = base * 2^attempt`
- Have written a working exponential-backoff retry loop in Go
- Recognise the difference between *retryable* and *non-retryable* errors
- Know what *idempotency* means and why it matters before you press "retry"
- Be able to spot the most common first-time bug — retrying forever, or retrying on an error you should have surfaced

You do not need to know about jitter, context cancellation, circuit breakers, or retry budgets yet. Those are the middle, senior, and professional levels. Start here.

---

## Prerequisites

- **Required:** Go 1.20 or newer. Check with `go version`.
- **Required:** Comfort writing a `main` function and a top-level helper function. You should be able to compile and run a `hello.go`.
- **Required:** Knowledge of `for` loops, `if err != nil`, and how a Go function returns `(T, error)`.
- **Required:** Basic familiarity with `time.Sleep(d time.Duration)`. If you can write `time.Sleep(2 * time.Second)`, you are ready.
- **Helpful:** Some exposure to `net/http` — making a `GET` request with `http.Get`.
- **Helpful:** Understanding that network calls can fail and that the failure shows up as a non-nil `error`.

You do not need to know `context.Context`, channels, goroutines beyond `go f()`, or anything about concurrency primitives. The retry loop in this file is single-goroutine, blocking, and uses only `time.Sleep`.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Retry** | The act of repeating a failed operation in the hope it will succeed this time. |
| **Backoff** | A policy that decides how long to wait between retries. The opposite of "retry immediately". |
| **Constant backoff** | Wait the same fixed duration between every retry. Simplest possible policy. |
| **Linear backoff** | Wait an amount that grows linearly: 1s, 2s, 3s, 4s. |
| **Exponential backoff** | Wait an amount that grows geometrically: 1s, 2s, 4s, 8s, 16s. The next wait is the previous wait multiplied by a constant factor (almost always 2). |
| **Attempt** | One execution of the operation. Attempt 1 is the first try; attempt 2 is the first retry. |
| **Retry count** | How many *additional* attempts beyond the first you have made. Often confusingly equated with "attempt number minus one". |
| **Base delay** | The wait before the first retry. For an exponential schedule `base * 2^n`, when `n = 0` the delay is just `base`. |
| **Cap** | The maximum delay you will ever wait. Without a cap, an exponential schedule can produce hours of wait. |
| **Transient error** | An error that may go away if you wait and try again — for example, `connection refused`, a `500` from a momentarily restarting server, or a packet drop. |
| **Permanent error** | An error that will not go away by retrying — for example, `404 Not Found`, `401 Unauthorized`, or a parse error in your request body. |
| **Idempotent** | An operation is idempotent if performing it twice produces the same result as performing it once. `GET /users/42` is idempotent; `POST /charge-customer` usually is not. |
| **Thundering herd** | A failure mode in which many clients retry simultaneously after a service blip, overwhelming the recovering service. Exponential backoff alone does not prevent this; jitter does. |
| **Jitter** | Random variation added to the backoff delay so that not every client retries at the same instant. Introduced at the middle level. |
| **`time.Sleep`** | A blocking call that pauses the current goroutine for the given `time.Duration`. The simplest tool for backoff at this level. |
| **`time.Duration`** | A `time.Duration` is a `int64` count of nanoseconds. `time.Second` is `1000000000` of these. |

---

## Why Retry At All

Before you can write a retry loop, you must believe that retrying is sometimes correct. Many programmers — especially those coming from single-process desktop or local-script backgrounds — instinctively *surface* every error to the user. That instinct is healthy in many places. In networked code it is wrong.

Consider three failure modes:

1. **A packet is dropped.** The TCP stack will resend it transparently — but if the connection-establishment SYN was dropped and you set a short connect timeout, you see a `dial tcp: i/o timeout` error. Re-dialing a second later almost always succeeds.
2. **A server is mid-deploy.** Between the moment the old instance terminates and the new one starts answering, a load balancer may briefly route to nothing and return `503`. The blip lasts a few hundred milliseconds. Surfacing this to the user as "the service is broken" is an over-reaction.
3. **A database read replica fails over.** During the failover, queries to the now-dead replica return `connection refused`. After the load balancer notices, queries to the new primary succeed. The window is seconds.

In each case, the *correct* user-facing behaviour is "your request worked", and the *technically simplest* way to achieve that is to retry the operation a few times before giving up. The user sees a slightly slower request; they do not see an error.

The flip side is also important. Retrying is *never* free:

- The user is waiting. A 1-second base delay means the user sees a 1-second pause even on the fastest successful retry.
- The failing server is under load. Retries from many clients amplify the load. A server that is sick because of CPU pressure gets sicker when 10× retries arrive.
- The user's request may not be idempotent. A retried `POST /charge-card` can double-charge a customer if you are not careful.
- Cascading retries multiply: if A retries 3 times, and each call to B retries 3 times, and each call to C retries 3 times, then a single user request could produce 27 calls to C.

For all of these reasons, retry policy is not "more is better". The job of an exponential backoff schedule is to balance the benefit (the call works after one or two retries) against the cost (extra latency, extra load).

The rest of this file is about getting that balance right with the simplest possible tools.

---

## The Naive Constant Backoff

The simplest possible backoff is to wait the same amount every time. In code:

```go
package main

import (
	"errors"
	"fmt"
	"time"
)

func doWork() error {
	return errors.New("simulated failure")
}

func main() {
	const maxAttempts = 5
	const delay = 1 * time.Second

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		err := doWork()
		if err == nil {
			fmt.Println("success on attempt", attempt)
			return
		}
		fmt.Printf("attempt %d failed: %v\n", attempt, err)
		if attempt < maxAttempts {
			time.Sleep(delay)
		}
	}
	fmt.Println("giving up after", maxAttempts, "attempts")
}
```

This is the *constant* backoff. Every retry waits exactly one second. Reading the loop top-to-bottom:

1. Try the operation.
2. If it succeeds, return.
3. Otherwise, print the failure.
4. If we have not yet reached the maximum, sleep one second.
5. Try again.
6. After `maxAttempts` failures, give up.

The schedule of delays is `[0, 1s, 1s, 1s, 1s]` — five attempts, four sleeps of one second each. The total time until "give up" is just under 4 seconds.

Constant backoff has two things going for it: it is dead simple, and it bounds the total time predictably. Both of those will matter later. But it has serious problems.

---

## What Goes Wrong With Constant Backoff

The fundamental flaw of constant backoff is that it treats every failure the same. Suppose the failing service needs 30 seconds to recover. Hitting it with a request every 1 second for 30 seconds means 30 wasted attempts that delay the recovery. If the service is overloaded, you are contributing to the overload — your client and 9,999 others, each retrying once a second, produce 10,000 requests per second of pure retry traffic on top of normal traffic.

A second flaw is that constant backoff does not separate "tiny blip" from "big outage". If the problem is a single dropped packet, you want to retry *quickly* — 50 milliseconds is enough. If the problem is a major outage, you want to back off to seconds, then tens of seconds, so you do not pound the failing system. A constant rate cannot satisfy both. Pick a small value and you spam during outages; pick a large value and short blips become unnecessarily slow.

A third flaw, less obvious, is that constant backoff still leaves all clients perfectly synchronised. If 10,000 clients all see a `503` at the same moment, they all retry exactly 1 second later, at the same moment. That is a *thundering herd*. Jitter is the antidote, and we will get to it at the middle level — but moving from constant to exponential is a prerequisite, because the exponential schedule gives you the *room* to randomise the wait without making the average wait too long.

For all these reasons, constant backoff is a teaching toy, not a production tool. Whenever you write `time.Sleep(1 * time.Second)` in a retry loop, your future self will hate your past self. Use exponential.

---

## The Exponential Idea

The exponential idea is simple: *each subsequent retry waits twice as long as the previous one.* That is all. If the first retry waits 100 ms, the second waits 200 ms, the third 400 ms, the fourth 800 ms, the fifth 1600 ms.

Why doubling? Three reasons.

**First, doubling matches the way distributed systems typically degrade and recover.** A server in trouble is not in trouble for 50 milliseconds; it is in trouble for seconds or tens of seconds. Exponential growth lets early retries handle short blips quickly (the 100 ms wait is barely noticeable) while late retries handle longer outages without burning the server.

**Second, doubling produces a self-limiting schedule.** After ten doublings of a 100 ms base, you are at 102.4 seconds. After fifteen, you are at 54 minutes. Without a cap, even exponential gets absurd — but the growth is *predictable* in a way that lets you reason about it. If you say "I will allow at most 5 retries with a 100 ms base", your worst-case total wait is `100 + 200 + 400 + 800 + 1600 = 3100 ms`, or about 3 seconds.

**Third, doubling is the conventional choice in the industry.** AWS, Google, and almost every retry library use it. Choosing a different multiplier (1.5, 3, e) is fine in theory but makes your code surprising to read. Stick with 2 unless you have a measured reason.

Some authors prefer to write the schedule as `base * factor^attempt` and let `factor` be configurable. That is fine. In this file we hard-code `factor = 2` for clarity.

---

## The Formula: base times 2 to the n

The canonical formula is:

```
delay(attempt) = base * 2^attempt
```

Where `attempt` is the *number of failed attempts so far* (so `attempt = 0` for the wait before the first retry). With `base = 100ms`:

| attempt | 2^attempt | delay |
|---------|-----------|-------|
| 0       | 1         | 100ms |
| 1       | 2         | 200ms |
| 2       | 4         | 400ms |
| 3       | 8         | 800ms |
| 4       | 16        | 1600ms |
| 5       | 32        | 3200ms |
| 6       | 64        | 6400ms |
| 7       | 128       | 12800ms |
| 8       | 256       | 25600ms |
| 9       | 512       | 51200ms |
| 10      | 1024      | 102400ms (~1.7 min) |

You can see why a cap is needed: after a dozen retries you are sleeping for hours. We will introduce the cap shortly.

In Go, the implementation is one line:

```go
delay := base * time.Duration(1<<attempt)
```

The shift `1 << attempt` computes `2^attempt` as an integer. We multiply by `base`, which is a `time.Duration`, so the result has the right type. *Be careful*: when `attempt` reaches 63 on a 64-bit machine, `1 << 63` is negative because of two's-complement overflow. We will discuss this trap in **Edge Cases** below.

A safer formula, when `attempt` is small but you want to be paranoid, uses `math.Pow`:

```go
delay := time.Duration(float64(base) * math.Pow(2, float64(attempt)))
```

This loses one nanosecond of precision and costs a `math.Pow` call, but it does not overflow. For the basic exponential we are writing, the shift is fine — we always cap `attempt` well below 30.

---

## Real-World Analogies

**Analogy 1: knocking on a door.** You knock on a friend's door. They do not answer. You wait 10 seconds and knock again. Still nothing. Now you wait 20 seconds, then 40, then 80, before knocking again. The idea is that if your friend is not home now, they are unlikely to be home in the next 10 seconds; waiting longer increases the chance the situation has changed. You are also doing your friend the courtesy of not annoying them every 10 seconds for an hour.

**Analogy 2: refreshing a page during an outage.** When a website is down and you refresh constantly every second, you are part of the problem. You contribute to the load that prevents the site from recovering. If everyone refreshes once a second, the server cannot stand up. If everyone backs off — refreshing initially every second, then every two, then every four — the load drops geometrically and the server has space to come back.

**Analogy 3: calling someone whose phone is busy.** You call. Busy. You wait 30 seconds, call again. Busy. Now you wait a minute. Then two. Then four. You do not call back instantly forever; that is harassment, not communication. Exponential backoff is the polite version.

**Analogy 4: a child asking for ice cream.** Ask once. "No." Wait 10 seconds. Ask again. "No." Wait 20. Ask again. "No." Wait 40... The child who waits longer between asks is more likely to get a "yes" eventually, and is less likely to be told to leave the room.

None of these analogies introduce jitter — they are not models for the full production policy. They are mental hooks for the doubling idea.

---

## Mental Models

### Model 1: "give the system time to heal"

The exponential schedule embodies the assumption that *the system you are calling needs time to recover*. Each doubling gives it more time. If the problem was a glitch, the first short wait already solves it. If the problem is deeper, you let the system have minutes, not milliseconds, before you check again.

### Model 2: "reduce the load you put on the failing system"

Equivalently, the exponential schedule limits the rate at which you contact the failing server. Constant backoff at 1 second means you call once a second forever. Exponential backoff means you call once at t=0, then at t=1s, then at t=3s, then at t=7s, then at t=15s. Your *rate* of calls drops over time. A failing server that is congested can recover when its load drops.

### Model 3: "the more it hurts, the less you press"

A simple piece of human-factors wisdom that maps directly onto exponential backoff. The longer the system has been failing, the longer you wait before pressing again. This is the opposite of panic-clicking the refresh button.

### Model 4: budget thinking

Even at the junior level, it helps to think of a *budget*: "I will spend at most X total seconds and at most N attempts retrying this." Anything that does not finish inside the budget surfaces as an error. The budget is your protection against retrying forever.

---

## Your First Working Example

Here is the smallest complete program that does exponential backoff in Go:

```go
package main

import (
	"errors"
	"fmt"
	"math/rand"
	"time"
)

// flakeyCall simulates a network call that succeeds 20% of the time.
func flakeyCall() (string, error) {
	if rand.Float64() < 0.2 {
		return "response body", nil
	}
	return "", errors.New("temporary network error")
}

func main() {
	const maxAttempts = 6
	const base = 100 * time.Millisecond

	var result string
	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		result, lastErr = flakeyCall()
		if lastErr == nil {
			fmt.Printf("success on attempt %d: %s\n", attempt+1, result)
			return
		}
		fmt.Printf("attempt %d failed: %v\n", attempt+1, lastErr)
		if attempt < maxAttempts-1 {
			delay := base * time.Duration(1<<attempt)
			fmt.Printf("  sleeping %v before next retry\n", delay)
			time.Sleep(delay)
		}
	}
	fmt.Printf("giving up after %d attempts: %v\n", maxAttempts, lastErr)
}
```

Compile and run:

```
go run main.go
```

You will see output like:

```
attempt 1 failed: temporary network error
  sleeping 100ms before next retry
attempt 2 failed: temporary network error
  sleeping 200ms before next retry
attempt 3 failed: temporary network error
  sleeping 400ms before next retry
success on attempt 4: response body
```

Or, on an unlucky run, all six attempts fail and you give up. The total worst-case wait is `100ms + 200ms + 400ms + 800ms + 1600ms = 3100ms` of sleep, plus six function-call latencies.

This is exponential backoff. Everything we add in subsequent files is refinement: jitter, context, idempotency checks, circuit breakers, observability. The bone is here.

---

## Step-by-Step Walkthrough

Let us walk through the working example line by line, because most of the subtleties you must learn are visible right here.

```go
const maxAttempts = 6
const base = 100 * time.Millisecond
```

Two policy constants. `maxAttempts` is the total number of *tries* (not retries). Six attempts means five retries. `base` is the delay before the first retry; subsequent delays double from there.

You should always make these configurable in real code — as function parameters, struct fields, or settings loaded from a config file. Hard-coding here is for clarity.

```go
var result string
var lastErr error
for attempt := 0; attempt < maxAttempts; attempt++ {
```

A `for` loop indexed by `attempt`, starting from zero. We declare `result` and `lastErr` outside the loop because we want to return them after the loop ends.

The choice of indexing from 0 versus 1 is a style decision. I prefer 0-indexed because it makes `1<<attempt` line up nicely: when `attempt == 0`, `1 << 0 == 1`, so the delay is `base`. When `attempt == 5`, `1 << 5 == 32`, so the delay is `32 * base`. The printed message uses `attempt+1` so the user sees "attempt 1, 2, 3..." rather than "attempt 0, 1, 2...".

```go
result, lastErr = flakeyCall()
if lastErr == nil {
    fmt.Printf("success on attempt %d: %s\n", attempt+1, result)
    return
}
```

Call the function. If it succeeded, we are done — return immediately. This is the *happy path*; in a real function you would return `result, nil` rather than print and return void.

```go
fmt.Printf("attempt %d failed: %v\n", attempt+1, lastErr)
```

The call failed. Log the failure. In production code this would be a structured log entry — `log.Error("call failed", "attempt", attempt+1, "err", lastErr)` — not a `Printf` to stdout.

```go
if attempt < maxAttempts-1 {
    delay := base * time.Duration(1<<attempt)
    fmt.Printf("  sleeping %v before next retry\n", delay)
    time.Sleep(delay)
}
```

This is the most important block. The `if attempt < maxAttempts-1` guard prevents us from sleeping *after* the final attempt — there is no next retry, so no reason to wait. Without this guard the user sees a useless 1600 ms pause before the "giving up" message.

Then `delay := base * time.Duration(1<<attempt)` computes the doubling delay. When `attempt == 0`, delay is `base`. When `attempt == 1`, delay is `2*base`. And so on.

`time.Sleep(delay)` blocks the goroutine for that duration.

```go
fmt.Printf("giving up after %d attempts: %v\n", maxAttempts, lastErr)
```

After the loop, if we reach here, every attempt failed. We log the final error.

In a real function, the structure would be:

```go
func callWithRetry() (string, error) {
    var lastErr error
    for attempt := 0; attempt < maxAttempts; attempt++ {
        result, err := flakeyCall()
        if err == nil {
            return result, nil
        }
        lastErr = err
        if attempt < maxAttempts-1 {
            time.Sleep(base * time.Duration(1<<attempt))
        }
    }
    return "", fmt.Errorf("after %d attempts: %w", maxAttempts, lastErr)
}
```

Note the use of `fmt.Errorf("...: %w", lastErr)` so callers can `errors.Is` or `errors.As` against the underlying error type. We will use this pattern repeatedly throughout the section.

---

## Variants of the Naive Formula

There are a few related formulas you will encounter in other people's code or in textbooks.

### Variant 1: `base * factor^attempt`

```go
delay := time.Duration(float64(base) * math.Pow(factor, float64(attempt)))
```

This lets you choose a multiplier other than 2. With `factor = 1.5`, delays grow more slowly: `100, 150, 225, 337, 506, 759 ms`. With `factor = 3`, they grow much faster: `100, 300, 900, 2700, 8100 ms`.

A factor of 2 is conventional. A factor of 1.5 is a reasonable choice when you want gentler growth. A factor below 1.2 is barely exponential — almost linear — and rarely helpful. A factor above 3 is so aggressive you might as well skip ahead.

### Variant 2: `base + step * 2^attempt`

Some libraries use a fixed step in addition to a base:

```go
delay := base + step*time.Duration(1<<attempt)
```

This produces a schedule like `base+step, base+2*step, base+4*step, ...`. It is rare in modern code; the simpler `base * 2^attempt` form has almost completely replaced it. Mentioned here only so you recognise it if you see it.

### Variant 3: Fibonacci backoff

```
delay(n) = delay(n-1) + delay(n-2)
```

The Fibonacci sequence `1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89` grows more slowly than `2^n` but faster than linear. Some old papers prefer it because it produces smoother growth. It is uncommon today; `2^n` is the standard.

For the rest of this section we use `base * 2^attempt`. The middle level will introduce *jitter*, which modifies this in interesting ways.

---

## Why You Must Cap the Delay

We saw earlier that `base = 100ms` and `attempt = 20` gives `100ms * 2^20 = 104,857,600 ms`, or about 29 hours. No human user is willing to wait 29 hours for a retry. No background system should retry once a day — that is not retrying, that is scheduling.

A cap, sometimes called `maxDelay` or `maxInterval`, limits how large the delay can grow:

```go
const maxDelay = 30 * time.Second

delay := base * time.Duration(1<<attempt)
if delay > maxDelay {
    delay = maxDelay
}
```

Or, more idiomatically with the `min` helper introduced in Go 1.21:

```go
delay := min(base*time.Duration(1<<attempt), maxDelay)
```

With `base = 100ms`, `factor = 2`, and `maxDelay = 30s`:

| attempt | uncapped | capped |
|---------|----------|--------|
| 0       | 100ms    | 100ms  |
| 1       | 200ms    | 200ms  |
| 2       | 400ms    | 400ms  |
| 3       | 800ms    | 800ms  |
| 4       | 1.6s     | 1.6s   |
| 5       | 3.2s     | 3.2s   |
| 6       | 6.4s     | 6.4s   |
| 7       | 12.8s    | 12.8s  |
| 8       | 25.6s    | 25.6s  |
| 9       | 51.2s    | 30s    |
| 10      | 102.4s   | 30s    |

After attempt 8, the schedule plateaus at 30 seconds. This is useful: you keep retrying, but no individual wait is absurd.

The cap also protects against the integer-overflow bug: even if `attempt` somehow reaches 63, the cap caught the wrap-around. (Still, you should cap `attempt` separately, as we will see.)

---

## Why You Must Cap the Number of Retries

Capping the *delay* prevents any single wait from being absurd. Capping the *number of attempts* prevents the total elapsed time from being unbounded.

Why does this matter? Two reasons.

**First, the user is waiting.** Most real retry loops happen inside a request handler. The user clicked a button or sent an API call. They are watching a spinner. The longer your retry loop runs, the more likely they give up, refresh, or call support. A retry budget of 5 attempts with a 30s cap is plenty — after the inner attempts of a few seconds, no human waits a minute for "the API was being flaky".

**Second, the program may never make progress.** If the target service is *permanently* down (the deploy failed; the database has crashed; a misconfigured firewall rule), retrying forever just turns your process into a polling client. You consume goroutines, file descriptors, and CPU forever. Eventually you run out of memory or are killed by an out-of-memory observer.

A retry-count cap is your guarantee that the function eventually returns. Without it, the function may never return at all.

A reasonable retry count for user-facing systems is 3 to 5. For background jobs that can afford to fail and be re-tried much later by an outer loop, 10 to 20 is fine. For idempotent writes that you cannot afford to lose, you may go higher — but you should also persist the operation and retry from outside the request handler.

---

## The Three Outcomes of a Retry Loop

A retry loop has exactly three outcomes:

1. **Success.** The operation eventually succeeded; you return the result.
2. **Permanent failure surfaced early.** The operation failed in a way that retrying could never fix (e.g. `404 Not Found`, `400 Bad Request`). You should *not* retry; surface the error immediately.
3. **Retry budget exhausted.** Every retry failed; you give up and return the last error, perhaps wrapped with context like "after 5 attempts: ...".

You should write your retry loop so that *all three of these are easy to see in the code*. Mixing them up — for example, treating a `404` as "retry-able" and burning your full budget on something that will never succeed — is one of the most common bugs in production retry code.

The structure looks like:

```go
func callWithRetry(...) (T, error) {
    var lastErr error
    for attempt := 0; attempt < maxAttempts; attempt++ {
        result, err := call()
        if err == nil {
            return result, nil // outcome 1: success
        }
        if !isRetryable(err) {
            return zero, err // outcome 2: permanent failure
        }
        lastErr = err
        sleepBeforeNextRetry(attempt)
    }
    return zero, fmt.Errorf("after %d attempts: %w", maxAttempts, lastErr) // outcome 3
}
```

The `isRetryable` predicate is where most of the design lives. We will write a real one in the next section.

---

## Distinguishing Retryable from Non-Retryable Errors

Not every error should be retried. Some errors are *transient* — they will likely go away. Some are *permanent* — they will never go away no matter how many times you retry.

Retryable errors include:

- Network errors: `connection refused`, `connection reset`, `i/o timeout`, DNS lookup failures
- HTTP `5xx` status codes (except a few rare ones like `501 Not Implemented`)
- HTTP `429 Too Many Requests` (with care — see the `Retry-After` header)
- gRPC `UNAVAILABLE`, `DEADLINE_EXCEEDED`, `RESOURCE_EXHAUSTED`
- Database "connection lost" or "deadlock detected" errors

Non-retryable errors include:

- HTTP `4xx` other than `429`: `400`, `401`, `403`, `404`, `422`
- gRPC `INVALID_ARGUMENT`, `NOT_FOUND`, `ALREADY_EXISTS`, `PERMISSION_DENIED`
- Authentication errors
- Parse errors in your request body
- Errors caused by user-provided input that is malformed

The simplest implementation classifies based on the type of error:

```go
import (
    "errors"
    "net"
)

func isRetryable(err error) bool {
    if err == nil {
        return false
    }
    // network errors are generally retryable
    var netErr net.Error
    if errors.As(err, &netErr) {
        return true
    }
    return false
}
```

For HTTP, a slightly fuller version:

```go
func isRetryableHTTP(resp *http.Response, err error) bool {
    if err != nil {
        // network-level error; retry
        return true
    }
    if resp.StatusCode == 429 {
        return true
    }
    if resp.StatusCode >= 500 && resp.StatusCode <= 599 {
        return true
    }
    return false
}
```

You will refine this as your code matures. The principle is: *retry only the things that retrying might fix.*

---

## HTTP Status Codes That Are Usually Retryable

| Code | Meaning | Retryable? |
|------|---------|------------|
| 408  | Request Timeout | yes |
| 425  | Too Early | yes |
| 429  | Too Many Requests | yes (respect `Retry-After`) |
| 500  | Internal Server Error | yes |
| 502  | Bad Gateway | yes |
| 503  | Service Unavailable | yes (respect `Retry-After`) |
| 504  | Gateway Timeout | yes |

Anything in the `5xx` range is by definition a *server* error, and saying "the server is broken" is implicitly saying "this may be transient". `429` is special because the server is explicitly telling you to slow down.

---

## HTTP Status Codes That Are Not Retryable

| Code | Meaning | Retryable? |
|------|---------|------------|
| 400  | Bad Request | no — your request is malformed |
| 401  | Unauthorized | no — your credentials are wrong |
| 403  | Forbidden | no — you do not have permission |
| 404  | Not Found | no — the resource does not exist |
| 405  | Method Not Allowed | no |
| 409  | Conflict | usually no |
| 410  | Gone | no |
| 422  | Unprocessable Entity | no |

A few of these have edge cases. A `401` can become retryable if your retry includes refreshing the token. A `409 Conflict` from an optimistic-locking system can be retryable if you re-read the resource and re-apply your update. But by default, a `4xx` (other than `429`) means *something is wrong with your request, not with the server*. Retrying without changing the request is pointless.

---

## The Retry-After Header

When a server returns `429` or `503`, it may include a `Retry-After` header telling the client how long to wait before retrying. The header can be either a number of seconds (`Retry-After: 60`) or an HTTP-date (`Retry-After: Wed, 21 Oct 2026 07:28:00 GMT`).

If the server tells you when to retry, *honour it*. This is the polite thing to do and often the only way to recover from rate-limited APIs.

```go
import (
    "net/http"
    "strconv"
    "time"
)

func retryAfterDelay(resp *http.Response) (time.Duration, bool) {
    h := resp.Header.Get("Retry-After")
    if h == "" {
        return 0, false
    }
    if secs, err := strconv.Atoi(h); err == nil {
        return time.Duration(secs) * time.Second, true
    }
    if t, err := http.ParseTime(h); err == nil {
        return time.Until(t), true
    }
    return 0, false
}
```

In your retry loop, if `Retry-After` is present, prefer it to your computed exponential delay. The server knows when it expects to be ready; your formula is a guess. Combining the two — using `max(computed, retryAfter)` — is a common pattern.

---

## Idempotency: The Word You Must Learn

An operation is **idempotent** if performing it N times has the same effect as performing it once. The word is unwieldy, but the idea is simple: *can I do this twice and not break anything?*

Examples:

- `GET /users/42` — idempotent. Calling it twice fetches the user twice but does not change any state.
- `PUT /users/42` with a complete user object — idempotent. The second call has the same effect (overwrite to the same state).
- `DELETE /users/42` — idempotent in HTTP-spec terms, though the second call may return `404` because the user is already gone.
- `POST /charge-customer/42` — **not** idempotent unless you have explicitly made it so. Calling it twice might charge the customer twice.
- `INSERT INTO orders (...) VALUES (...)` — **not** idempotent. Two inserts produce two rows.

Why does this matter for retry? Because *you can only safely retry idempotent operations*. If you retry a non-idempotent operation, you may produce duplicates or extra side effects.

Three strategies for making non-idempotent operations safe to retry:

1. **Idempotency keys.** Generate a unique client-side ID for the request (e.g. a UUID). The server records IDs of recent requests. If it sees the same ID again, it returns the cached response instead of doing the work again. Stripe's API uses this.
2. **Conditional updates.** Use HTTP `If-Match` and `If-None-Match`, or database `WHERE version = X` clauses, so a duplicate write is rejected.
3. **Saga compensation.** If you do produce a duplicate, run a compensating action to undo it. Complex; usually a last resort.

For now, the rule is: *only retry GET requests and explicitly-idempotent POSTs.* If you find yourself wanting to retry a `POST /charge`, you must first design idempotency keys or you will create a financial disaster.

---

## Pros and Cons of Exponential Backoff

**Pros:**

- Handles short blips fast and long outages gently.
- Reduces load on the failing system proportionally to how long the failure has lasted.
- Simple to implement — five lines of Go.
- The math is easy to reason about and bound.
- Conventional; everyone reading your code will recognise it.

**Cons:**

- Without jitter, all clients still retry in lockstep (thundering herd).
- Without a cap, delays can grow absurdly large.
- Without a retry budget, the function may never return.
- Without idempotency, you can cause duplicates.
- The "best" parameters (base, factor, cap, max attempts) are workload-specific and require measurement.

The whole rest of this section is about turning the cons into solved problems.

---

## Use Cases

- **HTTP client retries** for calls to a flaky third-party API.
- **Database reconnects** when the connection pool's connection dies mid-query.
- **Kafka producer retries** when the broker is briefly unavailable during a leader election.
- **DNS resolution retries** during a brief network glitch.
- **Cloud SDK calls** — almost every AWS / GCP / Azure SDK implements exponential backoff internally for transient failures.
- **Webhook delivery** — when you, as a service provider, send a webhook and the customer's server returns `5xx`, you retry with exponential backoff over hours or days.
- **CI flakiness handling** — re-running a flaky test step.
- **Mobile-client API calls** when the radio is briefly unavailable.

---

## Code Examples

### Example 1: minimal retry for an HTTP GET

```go
package main

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

func httpGetWithRetry(url string) ([]byte, error) {
	const maxAttempts = 5
	const base = 100 * time.Millisecond
	const maxDelay = 5 * time.Second

	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		resp, err := http.Get(url)
		if err == nil && resp.StatusCode < 500 && resp.StatusCode != 429 {
			defer resp.Body.Close()
			body, err := io.ReadAll(resp.Body)
			if err != nil {
				return nil, err
			}
			if resp.StatusCode >= 400 {
				return nil, fmt.Errorf("client error: %d", resp.StatusCode)
			}
			return body, nil
		}
		if err != nil {
			lastErr = err
		} else {
			resp.Body.Close()
			lastErr = fmt.Errorf("server error: %d", resp.StatusCode)
		}
		if attempt < maxAttempts-1 {
			delay := base * time.Duration(1<<attempt)
			if delay > maxDelay {
				delay = maxDelay
			}
			time.Sleep(delay)
		}
	}
	return nil, fmt.Errorf("after %d attempts: %w", maxAttempts, lastErr)
}

func main() {
	body, err := httpGetWithRetry("https://example.com")
	if err != nil {
		fmt.Println("failed:", err)
		return
	}
	fmt.Println("got", len(body), "bytes")
}
```

This is the closest a junior should get to a "production" retry. Note the use of `errors.Is`/`%w` for wrapping. Note also that we close `resp.Body` even when we are retrying — failure to close leaks file descriptors.

### Example 2: a generic retry helper

```go
package retry

import (
	"errors"
	"fmt"
	"time"
)

// Operation is the function under retry. It returns nil for success.
type Operation func() error

// Do calls op until it succeeds or until maxAttempts is reached.
// Between attempts it sleeps base*2^attempt, capped at maxDelay.
func Do(op Operation, maxAttempts int, base, maxDelay time.Duration) error {
	if maxAttempts <= 0 {
		return errors.New("retry: maxAttempts must be > 0")
	}
	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		err := op()
		if err == nil {
			return nil
		}
		lastErr = err
		if attempt < maxAttempts-1 {
			delay := base * time.Duration(1<<attempt)
			if delay > maxDelay || delay < 0 {
				delay = maxDelay
			}
			time.Sleep(delay)
		}
	}
	return fmt.Errorf("after %d attempts: %w", maxAttempts, lastErr)
}
```

Usage:

```go
err := retry.Do(func() error {
    return doSomething()
}, 5, 100*time.Millisecond, 30*time.Second)
```

The `if delay < 0` guard catches integer overflow when `attempt` is huge. The `time.Duration(1 << attempt)` overflows at `attempt = 63` on a 64-bit machine, becoming a large negative number. With this guard you stay safe.

### Example 3: distinguishing retryable from non-retryable

```go
package retry

import (
	"errors"
	"fmt"
	"time"
)

type PermanentError struct {
	Err error
}

func (p *PermanentError) Error() string { return fmt.Sprintf("permanent: %v", p.Err) }
func (p *PermanentError) Unwrap() error { return p.Err }

// Permanent marks an error as not-to-be-retried.
func Permanent(err error) error { return &PermanentError{Err: err} }

func Do(op func() error, maxAttempts int, base, maxDelay time.Duration) error {
	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		err := op()
		if err == nil {
			return nil
		}
		var perm *PermanentError
		if errors.As(err, &perm) {
			return perm.Err
		}
		lastErr = err
		if attempt < maxAttempts-1 {
			delay := base * time.Duration(1<<attempt)
			if delay > maxDelay || delay < 0 {
				delay = maxDelay
			}
			time.Sleep(delay)
		}
	}
	return fmt.Errorf("after %d attempts: %w", maxAttempts, lastErr)
}
```

The caller signals "this is permanent, do not retry" by wrapping their error:

```go
err := retry.Do(func() error {
    resp, err := http.Get(url)
    if err != nil {
        return err
    }
    defer resp.Body.Close()
    if resp.StatusCode >= 400 && resp.StatusCode < 500 && resp.StatusCode != 429 {
        return retry.Permanent(fmt.Errorf("client error: %d", resp.StatusCode))
    }
    return nil
}, 5, 100*time.Millisecond, 30*time.Second)
```

This is essentially how the `cenkalti/backoff` library does it. We will see the same pattern later in `professional.md`.

### Example 4: passing a function returning a value

The minimal `Do` above only handles `func() error`. To return a value too, use a captured variable:

```go
var body []byte
err := retry.Do(func() error {
    var err error
    body, err = fetchBody()
    return err
}, 5, 100*time.Millisecond, 30*time.Second)
if err != nil {
    return nil, err
}
return body, nil
```

Or, with generics (Go 1.18+):

```go
func DoWithResult[T any](op func() (T, error), maxAttempts int, base, maxDelay time.Duration) (T, error) {
    var lastErr error
    var zero T
    for attempt := 0; attempt < maxAttempts; attempt++ {
        result, err := op()
        if err == nil {
            return result, nil
        }
        lastErr = err
        if attempt < maxAttempts-1 {
            delay := base * time.Duration(1<<attempt)
            if delay > maxDelay || delay < 0 {
                delay = maxDelay
            }
            time.Sleep(delay)
        }
    }
    return zero, fmt.Errorf("after %d attempts: %w", maxAttempts, lastErr)
}
```

Usage:

```go
body, err := retry.DoWithResult(func() ([]byte, error) {
    return fetchBody()
}, 5, 100*time.Millisecond, 30*time.Second)
```

### Example 5: retrying a database query

```go
package main

import (
	"database/sql"
	"errors"
	"fmt"
	"time"
)

func queryWithRetry(db *sql.DB, query string, args ...any) (*sql.Rows, error) {
	const maxAttempts = 3
	const base = 50 * time.Millisecond

	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		rows, err := db.Query(query, args...)
		if err == nil {
			return rows, nil
		}
		if errors.Is(err, sql.ErrNoRows) {
			return nil, err // no rows is not transient
		}
		// other errors may be transient (driver disconnect, deadlock)
		lastErr = err
		if attempt < maxAttempts-1 {
			time.Sleep(base * time.Duration(1<<attempt))
		}
	}
	return nil, fmt.Errorf("after %d attempts: %w", maxAttempts, lastErr)
}
```

Database retries deserve their own discussion — deadlocks especially are usually retried on the *transaction*, not the individual statement. But the shape of the loop is the same.

### Example 6: showing the bug pattern (do not do this)

```go
// Do not do this!
for {
    err := callRemote()
    if err == nil {
        return nil
    }
    time.Sleep(1 * time.Second)
}
```

This is *constant* backoff with *no cap* on attempts. It will loop forever during a permanent outage, consuming a goroutine indefinitely. We will see this exact pattern in `find-bug.md`.

---

## Coding Patterns

### Pattern A: helper function over inline loop

Always extract the retry into a helper, even if it is short. Inline retry loops scatter through your codebase and make it impossible to centrally tune parameters.

```go
// Good
result, err := withRetry(func() (Result, error) { return remoteCall() })

// Bad — inline retry tangled with business logic
for attempt := 0; attempt < 5; attempt++ {
    result, err := remoteCall()
    if err == nil {
        // ... 50 lines of post-processing ...
    }
    time.Sleep(...)
}
```

### Pattern B: surface the last error, not just "retry exhausted"

When all retries fail, the caller wants to know *why*. Wrap the last error:

```go
return fmt.Errorf("calling remoteAPI after %d attempts: %w", maxAttempts, lastErr)
```

Now `errors.Is(err, io.EOF)` still works at the call site.

### Pattern C: parameterise base / cap / count

A retry helper that hard-codes 5 attempts and 100ms base is useful exactly once. Pass them in. Or, even better, accept a *policy struct*:

```go
type Policy struct {
    MaxAttempts int
    Base        time.Duration
    MaxDelay    time.Duration
}
```

### Pattern D: log attempts at debug, not info

A retry that succeeded on attempt 2 should not produce a `WARN`-level log line. The user got their answer. Log at debug. Reserve warns for "all retries failed".

---

## Clean Code

- Name the retry helper something descriptive: `withRetry`, `retryUntilSuccess`, `callWithBackoff`. Not just `do` or `wrap`.
- Keep the retry helper to a single responsibility: "call this function up to N times with growing delays". Do not try to also handle metrics, logging, and circuit breaking in the same function.
- Pass parameters by struct when they exceed three.
- Document the math in a comment near the constants: `// delay = base * 2^attempt, capped at maxDelay`.
- Test the helper with a fake operation that fails N-1 times then succeeds.

---

## Error Handling

The retry loop has three error-handling concerns:

1. **Distinguishing transient from permanent.** Use a predicate or a wrapper type like `PermanentError`. Do not retry on every error.
2. **Preserving the last error for the caller.** Wrap with `%w` so `errors.Is` / `errors.As` still work upstream.
3. **Surfacing context.** Tell the caller how many attempts you made. The error `"after 5 attempts: dial tcp: i/o timeout"` is far more useful than `"i/o timeout"`.

A common mistake is silently swallowing errors during retries. Even if you ultimately succeed on attempt 4, log the failures — but at debug level. If you ultimately fail, log them at warn or error level.

---

## Performance Tips

- `time.Sleep` is cheap but not free. It allocates a timer in the runtime. For tight retry loops you do not notice. For hot paths, prefer `time.NewTimer` reuse, but rarely necessary at the junior level.
- Compute `delay` once per loop iteration, not multiple times.
- Avoid `math.Pow` for power-of-two delays; use bit shift `1 << attempt`. (But guard against overflow.)
- Do not retry inside a hot inner loop. Retries belong at the boundary of your service — at the HTTP/RPC client level — not on every cache lookup.

---

## Best Practices

1. **Always cap delay.** Without a cap, a long-lived loop can produce hours of wait.
2. **Always cap attempts.** Without a cap, the function may never return.
3. **Distinguish transient from permanent errors.** Do not retry a `404`.
4. **Wrap the final error.** Use `fmt.Errorf("...: %w", lastErr)`.
5. **Log retries at debug, give-ups at warn.**
6. **Document idempotency assumptions** of the operation you are retrying.
7. **Make parameters configurable**, not hard-coded.
8. **Prefer a small library** — even `cenkalti/backoff` — over hand-rolling production retry code. But know how to write the hand-rolled version, which is what this file teaches.

---

## Edge Cases and Pitfalls

- **`1 << attempt` overflow.** When `attempt == 63` on a 64-bit machine, `1 << 63` is `-9223372036854775808`. Multiplying by `base` produces a *negative* duration. `time.Sleep` with a negative duration returns immediately, so your retry loop now spins at full speed with no waiting. *Always cap `attempt` so the shift cannot overflow*, or use `math.Pow`, or compute with a saturation check.
- **Sleeping after the last attempt.** A common bug: looping `attempt = 0; attempt < N; attempt++` and unconditionally calling `time.Sleep` at the end of each iteration produces an unnecessary wait after the final failure before returning. Guard with `if attempt < N-1`.
- **Calling `cancel()` while sleeping.** `time.Sleep` is not cancellable. If the caller wants to cancel the operation, you must use `time.NewTimer` plus `select` with `ctx.Done()`. This is the middle-level topic.
- **Retrying a non-idempotent operation.** If `op()` has side effects, retrying may cause duplicates. Verify idempotency before designing a retry.
- **Confusing `attempt` counts.** Some libraries count from 1, some from 0. Some count "total attempts including the first", others count "retries beyond the first". Be explicit in your function signature.
- **Using `time.After` in a loop.** `time.After(d)` creates a new timer each call and the timer is not garbage-collected until it fires. Loops over `time.After` leak timers. Use `time.Sleep` or `time.NewTimer`.

---

## Common Mistakes

1. **No cap on delay or attempts.** Infinite retries against a permanent failure.
2. **Retrying on a `4xx`.** Wasting attempts on something that will never succeed.
3. **Forgetting to close `resp.Body`.** File-descriptor leak across retries.
4. **Using `1 << attempt` without overflow protection.**
5. **Sleeping after the final attempt.** Cosmetic but irritating.
6. **Inline retry mixed with business logic.** Untestable.
7. **No jitter** (covered at middle level — but if all your clients retry in lockstep, you can take down a recovering server).
8. **Eating the error.** Logging the retry but throwing the actual error away, so the caller cannot diagnose.
9. **Mixing transient and permanent error handling.** Retrying everything means retrying things that will never succeed.
10. **Retrying inside the retry.** Nested retries multiply: 5 outer × 5 inner = 25 attempts.

---

## Common Misconceptions

- **"Exponential backoff prevents thundering herd."** It does not, on its own. Jitter does. With pure exponential, all clients still retry simultaneously — they just retry at the same exponential delays. We will discuss this carefully at the middle level.
- **"Doubling forever is fine because the cap will catch it."** Caps catch the duration, not the count. You still want a count cap.
- **"`time.Sleep` is bad in modern Go because it blocks the goroutine."** Blocking a goroutine that is itself dedicated to the retry is totally fine. Goroutines are cheap. The issue is only when you sleep on the main request goroutine while the client is waiting and could be cancelled — which is why context-aware sleep, covered next level, matters.
- **"Retries always make things better."** No. Retries amplify load on failing servers. If everyone retries 5× during an outage, the outage gets worse.

---

## Tricky Points

- The off-by-one between *attempts* and *retries*. "Three retries" typically means four total attempts (one initial + three retries). "Three attempts" means three total. Confusing the two is a common bug.
- `1 << 30 * time.Millisecond` is not `1 << (30 * time.Millisecond)` — Go's precedence makes `<<` bind tighter than `*`. Test this if you are unsure.
- `time.Duration(1<<attempt)` is a `Duration` in nanoseconds. Multiplied by `base` (also a `Duration`), the result has units of `Duration²`, which Go represents as a plain `int64` of nanoseconds — but the semantic units are now odd. Tools like `staticcheck` will flag `time.Duration * time.Duration` as suspect. The trick is to keep one side a *count* (the `1<<attempt`) and one side a `Duration` (`base`); the `time.Duration(...)` is really doing a *cast*, not a duration-typed value. The expression compiles because `time.Duration` is an alias for `int64`.
- A 100 ms base and a `maxDelay` of 30 s plateaus at attempt 8. Past attempt 8 you are doing constant 30 s backoff. Sometimes that is intended; sometimes you really want to give up sooner.

---

## Test

Write a test that proves your retry helper:

1. Succeeds on the first attempt and does not sleep.
2. Succeeds on the third attempt after two failures.
3. Gives up after `maxAttempts` failures and returns the wrapped error.
4. Surfaces a permanent error immediately without sleeping.

```go
package retry_test

import (
	"errors"
	"testing"
	"time"

	"yourmodule/retry"
)

func TestSuccessFirstTry(t *testing.T) {
	calls := 0
	err := retry.Do(func() error {
		calls++
		return nil
	}, 5, 1*time.Millisecond, 10*time.Millisecond)
	if err != nil {
		t.Fatalf("expected nil, got %v", err)
	}
	if calls != 1 {
		t.Fatalf("expected 1 call, got %d", calls)
	}
}

func TestSuccessThirdTry(t *testing.T) {
	calls := 0
	err := retry.Do(func() error {
		calls++
		if calls < 3 {
			return errors.New("transient")
		}
		return nil
	}, 5, 1*time.Millisecond, 10*time.Millisecond)
	if err != nil {
		t.Fatalf("expected nil, got %v", err)
	}
	if calls != 3 {
		t.Fatalf("expected 3 calls, got %d", calls)
	}
}

func TestExhausted(t *testing.T) {
	want := errors.New("always fails")
	err := retry.Do(func() error { return want }, 3, 1*time.Millisecond, 10*time.Millisecond)
	if !errors.Is(err, want) {
		t.Fatalf("expected wrapped %v, got %v", want, err)
	}
}
```

Use tiny base and cap durations in tests so the test does not actually take 30 seconds.

---

## Tricky Questions

**Q1.** A junior coworker writes `time.Sleep(base * 2^attempt)` in Go. Why does it not compile?
A: Go does not have a `^` exponent operator. `^` is bitwise XOR. The correct shift is `1 << attempt`.

**Q2.** What is the worst-case total wait for 10 attempts with `base = 100ms` and no cap?
A: `100ms * (1 + 2 + 4 + ... + 512) = 100ms * 1023 = 102,300ms` or about 1.7 minutes.

**Q3.** Is `time.Sleep(0)` legal?
A: Yes. It is essentially a `runtime.Gosched`. The goroutine yields and resumes when the scheduler picks it up.

**Q4.** What happens if `base = 0`?
A: Every delay is zero. The loop spins as fast as it can. Effectively no backoff.

**Q5.** When you retry a `POST`, what risks do you run?
A: Duplicate side effects. The first call may have succeeded server-side but the response was lost; your retry creates a duplicate.

**Q6.** Why not use `math.Pow(2, attempt)` instead of `1 << attempt`?
A: `math.Pow` returns a `float64`. Converting to `time.Duration` (int64 nanoseconds) loses precision and is slower. But it is overflow-safe. The bit shift is fast but overflows at attempt 63.

**Q7.** Should you retry a `404 Not Found`?
A: No. The resource does not exist; retrying will not change that.

**Q8.** Should you retry a `403 Forbidden`?
A: No. Unless your retry includes re-authentication.

---

## Cheat Sheet

```
delay = base * 2^attempt          // simple exponential
delay = min(base * 2^attempt, cap) // exponential with cap

retryable: 5xx, 408, 425, 429, network errors
not retryable: 4xx (except 429)

Always:
- cap delay (`maxDelay`)
- cap attempts (`maxAttempts`)
- distinguish transient / permanent
- wrap final error with %w
- check idempotency

Naive shape:
for attempt := 0; attempt < maxAttempts; attempt++ {
    err := op()
    if err == nil { return nil }
    if !isRetryable(err) { return err }
    if attempt < maxAttempts-1 {
        time.Sleep(min(base * (1<<attempt), maxDelay))
    }
}
return wrappedErr
```

---

## Self-Assessment Checklist

- [ ] I can write a retry loop with exponential delays in under five minutes without looking anything up.
- [ ] I know why constant backoff is worse than exponential.
- [ ] I can name three retryable HTTP status codes and three non-retryable ones.
- [ ] I know the meaning of "idempotent" and can list two idempotent and two non-idempotent operations.
- [ ] I know why `1 << attempt` is dangerous past attempt 30.
- [ ] I know why you must cap both the delay and the number of attempts.
- [ ] I understand that exponential backoff alone does not solve thundering herd.

---

## Summary

Exponential backoff with no frills is a `for` loop, a `time.Sleep`, and a doubling delay. Three rules make it correct rather than disastrous: cap the delay, cap the attempts, and retry only on transient errors. The schedule `delay = base * 2^attempt`, capped at `maxDelay`, with `maxAttempts` total tries, is enough for most internal services.

What this file did *not* cover, but the next file will:

- Jitter. Without jitter, a thousand clients retrying in lockstep behave like one giant client that pulses every `base * 2^n` ms.
- Context cancellation. A user who hits "cancel" should not be stuck waiting for your remaining sleeps.
- Retry budgets. A system-wide cap on how much retry traffic you generate.

Read the middle-level file next.

---

## What You Can Build

With just the material in this file you can build:

- A retryable HTTP client wrapper for any internal API.
- A polling loop that backs off when no work is available.
- A reconnect handler for a websocket or database connection.
- A startup hook that waits for a dependency to become healthy.
- A CI step retry wrapper.

---

## Further Reading

- Sam Newman, *Building Microservices*, chapter on resilience patterns.
- Michael Nygard, *Release It!* — the canonical reference on production-grade retry, timeouts, and circuit breakers.
- The `cenkalti/backoff` Go library README — a good real implementation to read after this file.
- AWS Architecture Blog: "Exponential Backoff and Jitter" — required reading before the senior file.

---

## Related Topics

- **Time-based concurrency** (this subsection): `time.Sleep`, `time.Timer`, `time.Ticker`.
- **Context** (topic 13 elsewhere in the concurrency track): cancellation and deadlines.
- **Error handling** (Go fundamentals): error wrapping, `errors.Is`, `errors.As`.
- **HTTP clients** (networking section): `net/http`, response codes, headers.

---

## Diagrams and Visual Aids

### The schedule

```
attempt:  1     2     3     4     5
delay:    -    100   200   400   800   1600 (ms)
              ↑     ↑     ↑     ↑     ↑
              base  2x    4x    8x    16x
```

### Constant vs exponential

```
constant (1s):
call ─wait─ call ─wait─ call ─wait─ call
     1s         1s         1s

exponential (base 100ms):
call ─wait─ call ─wait──── call ─wait──────── call
     100ms       200ms          400ms
```

The exponential schedule front-loads the retries: fast attempts at the start to catch quick blips, slow attempts later to be gentle on a stuck server.

### Where it fits in a request

```
user ─┐                                              ┌─ response
      │  retry loop (sleep, call, sleep, call, ...)  │
      └──────────────────────────────────────────────┘
              ↑                                ↑
       at most maxAttempts                 at most ~total = sum(delays)
```

The retry loop sits between the user and the external system. The user does not know there were retries; they see one slower request.

---

## Extended Walkthrough: Building a Production-Adjacent Retry Loop

The minimal retry loop earlier in this file is fine for learning. To bridge to the middle level we walk through the same loop again, but this time emphasising the *decisions* a real engineer makes at every step. We do this without yet introducing jitter or context — those come next. The goal of this extended walkthrough is to make every line of the basic retry feel familiar enough that the additions in `middle.md` are obvious refinements.

### Decision 1: where does this retry live?

Before writing the loop you must decide *where* in your codebase the retry lives. Three common places:

1. **At the boundary client.** Your service's `HTTPClient` wraps `*http.Client` and adds retry inside. Every caller of that client gets retry for free. This is the recommended location.
2. **At the call site.** Each function that calls the remote service has its own retry loop. Spreads retry policy across the codebase and makes it almost impossible to tune centrally.
3. **At the middleware level.** For inbound HTTP requests, you do *not* retry — that is the client's job. For outbound calls in a service mesh, the sidecar (Envoy, Linkerd) may retry for you. If the mesh retries, your code should not also retry, or you multiply traffic.

For most application code: put retry in the boundary client.

### Decision 2: what is the unit of work that retries?

A retry is for a single *idempotent unit of work*. If your "operation" is "GET this URL, parse it, save the result to a database", and the GET succeeds but the database save fails, you do *not* want to re-GET. You want to retry only the database save. Split the unit accordingly.

A common mistake is wrapping the entire request handler in a retry. That double-charges every side effect. Retry the smallest idempotent unit, not the entire workflow.

### Decision 3: how many attempts, and what base?

The number of attempts you choose is a function of:

- How latency-sensitive the operation is. User-facing API call: 3 attempts max. Background job: 10+.
- How likely the operation is to be transient. If 90% of failures are transient, 3 attempts catches most. If 50%, you want more.
- How much load you can put on the dependency. A slow dependency with no headroom should see fewer retries.

The base delay you choose is a function of:

- How quickly the operation usually completes. A 10 ms call gets a 10–50 ms base. A 500 ms call gets a 100–500 ms base.
- How transient the failures are. Faster recovery means smaller base.

A sane default starting point: 3 attempts, 100 ms base, 5 s max delay. Tune from there.

### Decision 4: how do you measure whether your retry policy works?

Once you write the retry, instrument it. Track:

- How many requests retried at all? (If the answer is "0%", remove the retry.)
- For requests that retried, what attempt did they finally succeed on? (If everyone succeeds on attempt 2, your base may be too short.)
- How often does the loop give up? (If "give up" is common, retry is masking a real outage rather than smoothing a blip.)

Even at the junior level, add a counter:

```go
type retryStats struct {
    Total       int64
    Retried     int64
    Succeeded   int64
    GaveUp      int64
}
```

You will see these stats turned into Prometheus metrics in `professional.md`. For now, a `log.Printf("retry stats: %+v", stats)` at process shutdown is enough.

### Decision 5: how do you test the retry?

Unit-test the retry helper with a *fake operation*:

```go
type fakeOp struct {
    failures int
    calls    int
}

func (f *fakeOp) call() error {
    f.calls++
    if f.calls <= f.failures {
        return errors.New("simulated")
    }
    return nil
}
```

This lets you assert "after 3 simulated failures, the operation succeeded and the helper made exactly 4 calls". Far more reliable than testing against a real flaky service.

We will revisit testing strategies in the middle file when we discuss mocking `time.Sleep` so tests run instantly.

---

## Deeper Look at the Doubling Schedule

The exponential schedule `base * 2^attempt` is so canonical that it has a name in queueing theory: *geometric backoff*. Let us look at its properties.

### Total time elapsed after N attempts

The total time spent sleeping (not counting the time the calls themselves took) is:

```
total_sleep(N) = base * (2^N - 1)
```

(This is the sum of the geometric series `1 + 2 + 4 + ... + 2^(N-1)`.)

For `base = 100ms`:

| N (attempts) | total_sleep (uncapped) |
|--------------|------------------------|
| 1            | 0                      |
| 2            | 100ms                  |
| 3            | 300ms                  |
| 4            | 700ms                  |
| 5            | 1,500ms                |
| 6            | 3,100ms                |
| 7            | 6,300ms                |
| 8            | 12,700ms               |
| 9            | 25,500ms               |
| 10           | 51,100ms               |

This is the *worst-case* total wait: if every attempt fails up to N, you have spent this much time sleeping. If the operation succeeds on attempt K, you have spent `base * (2^(K-1) - 1)` sleeping.

### Why the dominant term is the last sleep

Notice that the *last* sleep is bigger than all previous sleeps combined:

```
2^(N-1) > 1 + 2 + 4 + ... + 2^(N-2) = 2^(N-1) - 1
```

So if your retry budget is N attempts with base B, the worst-case is dominated by the final sleep, which is `B * 2^(N-1)`. This intuition matters: increasing `N` by one *doubles* the worst-case duration. Adding "just one more retry" is a much bigger commitment than it looks.

### Picking N for a latency budget

You have a 5-second budget. How many attempts can you afford?

```
B * (2^N - 1) <= 5000ms
```

With `B = 100ms`, `2^N - 1 <= 50`, so `N <= log2(51) ≈ 5.67`, meaning 5 attempts. Worst-case 3.1 s of sleep, plus call latencies.

With `B = 1000ms`, `2^N - 1 <= 5`, so `N <= log2(6) ≈ 2.58`, meaning 2 attempts.

This is the math that drives the choice of `base` and `maxAttempts`. Senior engineers do this in their head; juniors should write it down.

### Probability of success

If each attempt has independent success probability `p`, the probability that at least one of N attempts succeeds is:

```
P(success in N attempts) = 1 - (1 - p)^N
```

With `p = 0.5` (50% per attempt):
- N=1: 50%
- N=2: 75%
- N=3: 87.5%
- N=4: 93.75%
- N=5: 96.875%

The marginal benefit of each retry shrinks. Going from N=1 to N=2 buys you 25 percentage points; going from N=4 to N=5 buys you 3.

In real systems failures are *not* independent — a server that is down for one client is usually down for all clients in the same window. So the formula is optimistic. But the shape is right: each additional retry buys diminishing returns.

This is part of why 3–5 attempts is the typical sweet spot.

---

## A More Realistic Example: Retrying an HTTP Call

Let us write a slightly more realistic example than the toy `flakeyCall`. The goal is to make `http.Get(url)` more robust without yet introducing jitter or context. We will reuse this example through the section and improve it step by step.

```go
package httpretry

import (
	"fmt"
	"io"
	"net/http"
	"time"
)

type Policy struct {
	MaxAttempts int
	Base        time.Duration
	MaxDelay    time.Duration
}

func DefaultPolicy() Policy {
	return Policy{
		MaxAttempts: 5,
		Base:        100 * time.Millisecond,
		MaxDelay:    5 * time.Second,
	}
}

type Client struct {
	http   *http.Client
	policy Policy
}

func NewClient(p Policy) *Client {
	return &Client{
		http:   &http.Client{Timeout: 10 * time.Second},
		policy: p,
	}
}

func (c *Client) Get(url string) ([]byte, error) {
	var lastErr error
	for attempt := 0; attempt < c.policy.MaxAttempts; attempt++ {
		body, err, retry := c.attempt(url)
		if err == nil {
			return body, nil
		}
		if !retry {
			return nil, err
		}
		lastErr = err
		if attempt < c.policy.MaxAttempts-1 {
			c.sleep(attempt)
		}
	}
	return nil, fmt.Errorf("get %s: after %d attempts: %w", url, c.policy.MaxAttempts, lastErr)
}

// attempt returns (body, error, retryable).
func (c *Client) attempt(url string) ([]byte, error, bool) {
	resp, err := c.http.Get(url)
	if err != nil {
		return nil, err, true // network errors are transient
	}
	defer resp.Body.Close()
	if resp.StatusCode == 429 || (resp.StatusCode >= 500 && resp.StatusCode <= 599) {
		return nil, fmt.Errorf("status %d", resp.StatusCode), true
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("status %d", resp.StatusCode), false // permanent
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err, true // read errors might be transient
	}
	return body, nil, false
}

func (c *Client) sleep(attempt int) {
	d := c.policy.Base * time.Duration(1<<attempt)
	if d > c.policy.MaxDelay || d < 0 {
		d = c.policy.MaxDelay
	}
	time.Sleep(d)
}
```

Reading this in full:

- `Policy` separates configuration from behaviour. You can have a "fast user-facing" policy and a "slow background" policy.
- `Client` wraps `*http.Client`. The retry is invisible to callers.
- `attempt` returns *three* values: body, error, and a `retry` bool. The bool is the predicate `isRetryable(err)` from earlier but inlined.
- `sleep` is its own helper so you can unit-test the schedule independently. We will replace `time.Sleep` with a context-aware sleep in `middle.md`.

This is the kind of code you can show in an interview as a "junior who has thought about retries". It is not perfect — it lacks jitter, context, observability — but it is *correct* for the cases it handles.

---

## Worked Example: Reading the Schedule on Paper

Let us walk a concrete failing-then-succeeding scenario step by step, with elapsed times.

Scenario: a service is briefly overloaded. Attempts 1–4 return `503`. Attempt 5 succeeds. Each `Get` call takes 50 ms. `base = 100ms`, `maxDelay = 5s`, `maxAttempts = 6`.

| t (ms) | event |
|--------|-------|
| 0      | attempt 1 starts |
| 50     | attempt 1 fails (503) |
| 50     | sleep `100ms * 2^0 = 100ms` |
| 150    | attempt 2 starts |
| 200    | attempt 2 fails (503) |
| 200    | sleep `100ms * 2^1 = 200ms` |
| 400    | attempt 3 starts |
| 450    | attempt 3 fails (503) |
| 450    | sleep `100ms * 2^2 = 400ms` |
| 850    | attempt 4 starts |
| 900    | attempt 4 fails (503) |
| 900    | sleep `100ms * 2^3 = 800ms` |
| 1700   | attempt 5 starts |
| 1750   | attempt 5 succeeds |

Total user-visible latency: 1750 ms. Without retries the user would have seen a `503` at t=50. With retries they see success at t=1750. Trade-off: 1.7 seconds of waiting in exchange for not seeing an error. Most users prefer the slow success.

If the service had stayed down: attempts 1–6 all fail. Total sleeping: `100 + 200 + 400 + 800 + 1600 = 3100 ms`. Plus six call latencies. The user sees the final error at roughly t = 50*6 + 3100 = 3400 ms after their click.

That is the latency cost of a 6-attempt retry budget. In a real system you decide whether 3.4 s of waiting is worth a 95-percentile improvement in success rate.

---

## Reading Other People's Retry Code

When you join a project, you will encounter retry code written by others. Here are the patterns you will see, in roughly increasing sophistication.

### Pattern: bare `for` with `time.Sleep`

```go
for i := 0; i < 5; i++ {
    if err := doIt(); err == nil { return nil }
    time.Sleep(time.Duration(1<<i) * time.Second)
}
```

Recognise it. Note `1 << i * time.Second` — Go's operator precedence puts `*` before `<<`? No: shift binds tighter, so this is `(1 << i) * time.Second`. Confirm by testing.

### Pattern: external library

```go
import "github.com/cenkalti/backoff/v4"

err := backoff.Retry(doIt, backoff.NewExponentialBackOff())
```

This is the canonical Go retry library. The default policy is exponential with jitter and a 15-minute total budget. We dissect it in `professional.md`.

### Pattern: hand-rolled with a callback

```go
err := retry.With(retry.Options{
    Attempts: 5,
    Base:     100 * time.Millisecond,
    Cap:      5 * time.Second,
}, func() error { return doIt() })
```

A team's internal retry library. The shape is similar to what we built above.

### Pattern: tangled with circuit breaker

```go
if !breaker.Allow() { return ErrCircuitOpen }
for i := 0; i < 5; i++ {
    err := doIt()
    breaker.Record(err)
    if err == nil { return nil }
    time.Sleep(...)
}
```

Combining retry and a circuit breaker (which we discuss properly in `professional.md`). The interaction is subtle: if you retry while the breaker is recording failures, you can trip the breaker faster than you intended.

### Reading checklist

For any retry code, ask:

1. What is `maxAttempts`?
2. What is `base`?
3. What is the cap?
4. Is there jitter?
5. Is `ctx` respected?
6. Which errors trigger retry?
7. Is the wrapped error preserved?

If three or more of those answers are "unclear" or "no", the retry needs work.

---

## A Note on Logging

Logging in a retry loop is more subtle than it looks. Three rules:

**Rule 1: log every attempt at DEBUG.** This is loud, but useful when you are debugging "why does this take so long". A debug log per attempt is fine.

**Rule 2: log retry-then-success at INFO with attempt count.** When a request retried 3 times and then succeeded, you want a single INFO log: "request succeeded on attempt 3". This makes flakiness visible.

**Rule 3: log give-up at WARN or ERROR.** When all retries failed, escalate. The caller wants to know.

```go
logger := log.New(os.Stderr, "", log.LstdFlags)

for attempt := 0; attempt < maxAttempts; attempt++ {
    err := op()
    if err == nil {
        if attempt > 0 {
            logger.Printf("INFO: succeeded on attempt %d", attempt+1)
        }
        return nil
    }
    logger.Printf("DEBUG: attempt %d failed: %v", attempt+1, err)
    if attempt < maxAttempts-1 {
        time.Sleep(base * time.Duration(1<<attempt))
    }
}
logger.Printf("WARN: gave up after %d attempts", maxAttempts)
```

In production you would use a structured logger (`zap`, `slog`) but the discipline is the same.

---

## Avoiding the Most Common Beginner Bug

Here is the bug 90% of juniors write the first time they implement retry:

```go
// WRONG
for {
    err := callIt()
    if err == nil {
        return nil
    }
    log.Printf("failed: %v, retrying", err)
    time.Sleep(1 * time.Second)
}
```

What is wrong?

1. **No max attempts.** The loop runs forever if the call keeps failing. The function never returns. The goroutine never exits. A user who clicked "save" sees a spinner that never stops.
2. **Constant 1-second backoff.** During an outage, this clobbers the failing service with one request per second per client.
3. **No distinction between transient and permanent errors.** A `404` triggers the same infinite loop as a transient blip.
4. **No context.** If the user cancels, the loop keeps running.
5. **Logs at info level by default.** Floods the logs during an outage.

Every single one of these mistakes is fatal in production. Avoiding them is what the rest of this section teaches.

The fix:

```go
// Better
ctx, cancel := context.WithTimeout(parent, 30*time.Second)
defer cancel()

const maxAttempts = 5
const base = 100 * time.Millisecond
const maxDelay = 5 * time.Second

var lastErr error
for attempt := 0; attempt < maxAttempts; attempt++ {
    err := callIt(ctx)
    if err == nil {
        return nil
    }
    if !isTransient(err) {
        return err
    }
    lastErr = err
    if attempt < maxAttempts-1 {
        delay := base * time.Duration(1<<attempt)
        if delay > maxDelay || delay < 0 {
            delay = maxDelay
        }
        select {
        case <-time.After(delay):
        case <-ctx.Done():
            return fmt.Errorf("cancelled while retrying: %w", ctx.Err())
        }
    }
}
return fmt.Errorf("after %d attempts: %w", maxAttempts, lastErr)
```

This uses `context.Context` and a `select` rather than `time.Sleep` — middle-level techniques we will explain next. But notice every fix maps onto one of the five problems with the original code.

---

## Hand-Tracing the Retry Loop

To cement the idea, trace this loop by hand:

```go
for attempt := 0; attempt < 4; attempt++ {
    err := op()      // assume fails attempts 0, 1; succeeds attempt 2
    if err == nil {
        return nil
    }
    if attempt < 3 {
        time.Sleep(100 * time.Millisecond * time.Duration(1<<attempt))
    }
}
return errors.New("exhausted")
```

Iteration `attempt=0`: `op()` fails. `attempt < 3` is true. Sleep `100ms * 2^0 = 100ms`.
Iteration `attempt=1`: `op()` fails. `attempt < 3` is true. Sleep `100ms * 2^1 = 200ms`.
Iteration `attempt=2`: `op()` succeeds. Return nil.

Total time: about `100 + 200 + (3 * call_latency)` ms.

Now trace with `op()` failing all four times:

Iteration `attempt=0`: fail. Sleep 100ms.
Iteration `attempt=1`: fail. Sleep 200ms.
Iteration `attempt=2`: fail. Sleep 400ms.
Iteration `attempt=3`: fail. `attempt < 3` is false, no sleep. Loop ends.
Return `errors.New("exhausted")`.

Total time: `100 + 200 + 400 + (4 * call_latency)` ms = 700 ms + latencies.

This is hand-tracing. Doing it for your own retry loops, especially the first time you write one, prevents off-by-one bugs.

---

## More Code Examples

### Example 7: extracting the schedule as a function

For clarity and testability, compute the delay in its own function:

```go
func backoffDelay(attempt int, base, maxDelay time.Duration) time.Duration {
    if attempt < 0 {
        return 0
    }
    if attempt >= 30 {
        return maxDelay // protect against overflow
    }
    d := base * time.Duration(1<<attempt)
    if d > maxDelay || d < 0 {
        return maxDelay
    }
    return d
}
```

Test it:

```go
func TestBackoffDelay(t *testing.T) {
    cases := []struct {
        attempt int
        base    time.Duration
        max     time.Duration
        want    time.Duration
    }{
        {0, 100 * time.Millisecond, 5 * time.Second, 100 * time.Millisecond},
        {1, 100 * time.Millisecond, 5 * time.Second, 200 * time.Millisecond},
        {5, 100 * time.Millisecond, 5 * time.Second, 3200 * time.Millisecond},
        {6, 100 * time.Millisecond, 5 * time.Second, 5 * time.Second}, // capped
        {30, 100 * time.Millisecond, 5 * time.Second, 5 * time.Second},
        {100, 100 * time.Millisecond, 5 * time.Second, 5 * time.Second}, // overflow guard
    }
    for _, tc := range cases {
        got := backoffDelay(tc.attempt, tc.base, tc.max)
        if got != tc.want {
            t.Errorf("attempt=%d: got %v, want %v", tc.attempt, got, tc.want)
        }
    }
}
```

The test is fast (microseconds) because it does not actually sleep. This separation of *computing the delay* from *sleeping for the delay* is a recurring theme; we will see it again in `professional.md` when we plug in a fake clock.

### Example 8: returning the attempt count to the caller

Sometimes the caller wants to know how many tries were needed:

```go
func DoWithCount(op func() error, maxAttempts int, base, maxDelay time.Duration) (int, error) {
    var lastErr error
    for attempt := 0; attempt < maxAttempts; attempt++ {
        err := op()
        if err == nil {
            return attempt + 1, nil // succeeded on this attempt
        }
        lastErr = err
        if attempt < maxAttempts-1 {
            time.Sleep(backoffDelay(attempt, base, maxDelay))
        }
    }
    return maxAttempts, fmt.Errorf("after %d attempts: %w", maxAttempts, lastErr)
}
```

Useful for metrics and observability.

### Example 9: configurable factor

If you want to allow factors other than 2:

```go
type Schedule struct {
    Base     time.Duration
    Factor   float64
    MaxDelay time.Duration
}

func (s Schedule) Delay(attempt int) time.Duration {
    if attempt < 0 {
        return 0
    }
    d := time.Duration(float64(s.Base) * math.Pow(s.Factor, float64(attempt)))
    if d > s.MaxDelay || d < 0 {
        return s.MaxDelay
    }
    return d
}
```

`math.Pow` is slower than `1 << attempt` but lets you write `Factor: 1.5`. For real applications the speed difference is irrelevant.

### Example 10: integrating with a real DNS lookup retry

```go
package main

import (
	"context"
	"fmt"
	"net"
	"time"
)

func lookupHostWithRetry(host string) ([]string, error) {
	const maxAttempts = 4
	const base = 50 * time.Millisecond

	var lastErr error
	resolver := net.DefaultResolver
	for attempt := 0; attempt < maxAttempts; attempt++ {
		ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
		addrs, err := resolver.LookupHost(ctx, host)
		cancel()
		if err == nil {
			return addrs, nil
		}
		lastErr = err
		if attempt < maxAttempts-1 {
			time.Sleep(base * time.Duration(1<<attempt))
		}
	}
	return nil, fmt.Errorf("lookup %s after %d attempts: %w", host, maxAttempts, lastErr)
}

func main() {
	addrs, err := lookupHostWithRetry("example.com")
	if err != nil {
		fmt.Println("failed:", err)
		return
	}
	fmt.Println("got addresses:", addrs)
}
```

This is a real, useful retry: DNS lookups occasionally fail in flaky networks, and retrying once or twice almost always succeeds.

### Example 11: retrying a Redis command

(Pseudo-code, since we have not added a Redis client to the example.)

```go
func getWithRetry(rdb *redis.Client, key string) (string, error) {
    const maxAttempts = 3
    const base = 25 * time.Millisecond

    var lastErr error
    for attempt := 0; attempt < maxAttempts; attempt++ {
        val, err := rdb.Get(context.Background(), key).Result()
        if err == redis.Nil {
            return "", err // key not found is not transient
        }
        if err == nil {
            return val, nil
        }
        lastErr = err
        if attempt < maxAttempts-1 {
            time.Sleep(base * time.Duration(1<<attempt))
        }
    }
    return "", fmt.Errorf("redis GET %q: %w", key, lastErr)
}
```

Note that `redis.Nil` (key-not-found) is a *permanent* signal, not a transient error.

---

## Failures You Will See In Practice

The retry loop's behaviour is shaped by the failure modes of the systems it is calling. A short tour of the modes you will encounter:

### Mode 1: cold start

The dependency just came online and is warming caches. Calls return `503` for a few seconds while it warms. Exponential retry handles this beautifully — your 5th attempt at ~1600 ms gives the dependency enough time to warm.

### Mode 2: rolling deploy

Old instances are being replaced. Load balancers occasionally route to drained instances. You see brief `connection refused` errors. Exponential retry handles this well; even 3 attempts is enough.

### Mode 3: overloaded server

The dependency is at 100% CPU. Some calls succeed, some time out. Retrying *adds load*. If 1% of normal requests fail and you retry 5×, you have added 5% to load on a server that is already overloaded. Exponential backoff helps because the retries spread out — but jitter is needed to keep them from synchronising.

### Mode 4: total outage

The dependency is gone (a region down, a process crashed and has not restarted). Every attempt fails. Retrying just adds to the noise. Your retry budget will be exhausted; you give up and surface the error. *Circuit breakers* (covered in `professional.md`) catch this case earlier so you do not retry-and-wait for every single user.

### Mode 5: persistent permanent error

You are calling an endpoint that no longer exists. Every attempt returns `404`. Without a "non-retryable" check, you burn the full budget on something that will never succeed. *This is why distinguishing transient from permanent matters.*

### Mode 6: slow but eventually-succeeding

The dependency is slow but answers eventually. Your first call times out (you set 1 s timeout, the server takes 2 s). You retry. The retry also times out. And so on. *Retrying does not help when the problem is "too slow"*. Either raise the timeout, or accept the error and propagate.

Recognising which mode you are in tells you whether retry is the right tool. Modes 1, 2, and 5 are clear: retry. Mode 3 is "retry but be careful". Modes 4 and 6 are signals to surface the error or use a different mechanism (circuit breaker, deadline budget).

---

## A Short Glossary Refresh

Before moving on to the middle level, make sure the following words are crystal clear. If any are fuzzy, re-read the section above with their definition in mind.

- **Backoff** — the policy that decides the wait between retries.
- **Base delay** — the wait before the first retry.
- **Cap** — the maximum any single wait can grow to.
- **Idempotent** — safe to repeat without side-effects.
- **Permanent error** — should not be retried.
- **Retryable error** — should be retried, possibly.
- **Thundering herd** — many clients retrying at the same instant after a service blip.
- **Jitter** — the randomisation that prevents thundering herd. Coming in `middle.md`.
- **Retry budget** — system-wide cap on retry traffic. Coming in `senior.md`.
- **Circuit breaker** — fail fast when a dependency is known to be down. Coming in `professional.md`.

---

## Self-Check Quiz

Before clicking to `middle.md`, answer these without scrolling:

1. Write the formula for exponential backoff with cap.
2. Why must you cap both the delay and the number of attempts?
3. List three retryable HTTP status codes.
4. List three non-retryable HTTP status codes.
5. What does `time.Sleep(base * time.Duration(1 << 63))` do? Why?
6. Why is constant backoff worse than exponential during an outage?
7. What does "idempotent" mean? Give two examples.
8. Why must you close `resp.Body` even when you are about to retry?
9. What is wrong with this code: `for { if err := call(); err == nil { return nil }; time.Sleep(1*time.Second) }`?
10. If `base = 50ms` and `maxAttempts = 8`, what is the worst-case total sleep (uncapped)?

Answers (cover and check):

1. `delay = min(base * 2^attempt, maxDelay)`
2. Without delay cap, individual waits can be hours. Without attempt cap, the loop may never return.
3. 408, 429, 500, 502, 503, 504, 425 (any three).
4. 400, 401, 403, 404, 405, 422 (any three).
5. Returns immediately (negative `time.Duration` due to int64 overflow at shift 63). Retry loop spins.
6. Constant rate during an outage keeps load on the failing server constant. Exponential rate drops, giving room to recover.
7. Idempotent: GET, PUT-with-full-state. Not idempotent: POST /charge, INSERT.
8. Failure to close leaks the underlying file descriptor and connection. Eventually you run out.
9. No max attempts, constant backoff, no context, no transient/permanent distinction.
10. `50 * (2^8 - 1) = 50 * 255 = 12,750 ms = 12.75 s.`

If you got 8 or more right, move on. If fewer, re-read the section.

---

## Wrap-Up

You now have the minimum viable mental model for exponential backoff: a `for` loop, a doubling delay, a delay cap, an attempt cap, transient/permanent classification, idempotency awareness. With this you can write retry code that is correct in 80% of cases.

The remaining 20% — the dangerous edge cases — is what the middle, senior, and professional files address. Specifically:

- **Middle:** jitter (so a thousand clients do not all retry at the same instant), context cancellation (so the user can stop waiting), and the concept of a retry budget.
- **Senior:** the math of thundering herds, deadline propagation across services, the AWS jitter formulas, retry storms, and the deep idempotency story.
- **Professional:** production tooling — `cenkalti/backoff`, integration with `net/http` transport, gRPC interceptors, circuit breaker composition, observability, and real postmortems.

If you remember nothing else from this file, remember the four-word recipe: *double, cap, count, classify*. Double the delay, cap the delay, cap the count, classify the error. With those four habits, your retry code is well above average.

---

## Appendix A: The Anatomy of `time.Sleep`

A retry loop is mostly a `time.Sleep`. Worth knowing what `time.Sleep` actually does.

The signature is:

```go
func Sleep(d Duration)
```

`time.Sleep` blocks the *calling goroutine* for at least the given duration. Internally it calls `runtime_nanotime` to read the monotonic clock, schedules a wakeup via the runtime's timer heap, and parks the goroutine. The Go runtime's `sysmon` (the system monitor goroutine) checks the timer heap and wakes the goroutine when its time has come.

Key properties:

1. **It blocks only the current goroutine.** Other goroutines run normally. The scheduler is happy to run thousands of goroutines that are sleeping.
2. **The duration is a lower bound, not an exact value.** Sleep may take slightly longer than requested, never less. Granularity depends on OS scheduling; typically ~1 ms on Linux, ~16 ms on Windows historically (modern Windows is better).
3. **It is not cancellable.** Once you call `time.Sleep(10 * time.Minute)`, the goroutine sleeps for ten minutes. No matter what happens elsewhere, the goroutine wakes up after ten minutes. If you want to cancel, do not use `time.Sleep`; use `time.NewTimer` plus `select`.
4. **Negative durations return immediately.** `time.Sleep(-1)` is a no-op. This is why integer overflow can break your retry loop.
5. **Zero duration is essentially `runtime.Gosched()`.** The goroutine yields and is rescheduled.

Most production retry libraries do not use `time.Sleep` directly; they use a context-aware sleep that respects cancellation. The middle level introduces this. At the junior level, `time.Sleep` is fine.

### A surprising property: stack size

Calling `time.Sleep` from a deeply-recursive function does not consume more memory while you sleep. Goroutine stacks shrink when they are idle. A sleeping goroutine holds ~8 KB or so, not the full stack it had when active. This is one reason Go can have millions of sleeping goroutines without memory pressure.

### The `time.After` trap

`time.After(d)` returns a channel that fires after duration `d`. It is convenient:

```go
select {
case <-time.After(5 * time.Second):
    // timeout
case <-someChan:
    // got a value
}
```

But: `time.After` creates a new `time.Timer` on each call, and the timer is *not* garbage-collected until it fires. In a tight loop:

```go
for {
    select {
    case <-time.After(1 * time.Second):
    case v := <-input:
        process(v)
    }
}
```

If `input` fires every 100 ms, you create ten timers per second that all sit in the runtime's timer heap waiting for their 1 s to elapse. Memory leak. The fix is to reuse a `*time.Timer`:

```go
t := time.NewTimer(1 * time.Second)
defer t.Stop()
for {
    select {
    case <-t.C:
        t.Reset(1 * time.Second)
    case v := <-input:
        process(v)
        if !t.Stop() {
            <-t.C
        }
        t.Reset(1 * time.Second)
    }
}
```

We will use this pattern in `middle.md` when we make the retry context-aware.

For pure `time.Sleep`-based retry, the trap does not apply. `time.Sleep` is properly garbage-collected after it returns. The trap is only with `time.After` and `select`.

---

## Appendix B: Why Doubling, Specifically?

Why is the multiplier 2? Could it be 1.5? 3? `e ≈ 2.718`?

Mathematically, any factor greater than 1 produces exponential growth. The choice between them is a trade-off between *aggressiveness* and *coverage*:

- A higher factor (3, 4) reaches large delays faster. Good when you expect long outages.
- A lower factor (1.5) grows more slowly. Good when retries are cheap and you want to catch the second-or-third-blip case.
- A factor of 2 is the classic compromise. It is also the convention in computer networking — TCP's congestion-window backoff doubles, Ethernet's CSMA/CD doubles. So "doubling" is what other engineers expect.

There is one mathematical reason to prefer 2: powers of two are easy to compute with a bit shift, which on every CPU is essentially free. Other multipliers require `math.Pow` or repeated multiplication.

A factor between 1.5 and 2 is sometimes used by libraries that want gentler growth without losing the exponential character. `cenkalti/backoff` defaults to `1.5`. We will see this in `professional.md`.

### Empirical evidence

The AWS Architecture Blog post that defines the modern jitter formulas tested factors of 1.5, 2, and 4 in simulations. All three produce dramatically better results than no backoff. The differences between them, with jitter applied, are small. So the choice of factor matters far less than the choice of *whether to back off at all*.

Conclusion: pick 2 unless you have a measured reason to pick something else.

---

## Appendix C: The Difference Between Retry and Backoff

The two words are often used interchangeably. They are not the same:

- **Retry** is the policy of repeating a failed operation. Anything from "try once more" to "loop forever" qualifies.
- **Backoff** is the policy of *waiting* between retries. It is one component of a retry policy.

So a retry policy might say:

- Try up to 5 times. (the count cap)
- Wait `base * 2^attempt` between tries, capped at `maxDelay`. (the backoff)
- Retry on transient errors only. (the classification)
- Use jitter to avoid lockstep. (the randomisation)

The backoff is the *delay schedule*. The retry is the *whole policy*. People say "exponential backoff" when they mean "retry with an exponential-backoff schedule". Both are common.

---

## Appendix D: Reading the Go Source for `time.Sleep`

For the curious, `time.Sleep` is implemented in the runtime. Here is a sketch of what happens:

1. `time.Sleep(d)` calls `time.runtimeNano()` to get the current monotonic time.
2. It calls `timeSleep(d)` (in `runtime/time.go`).
3. `timeSleep` creates a `timer` struct on the goroutine's stack (or heap, if the stack would grow).
4. The timer is added to the runtime's timer heap (a per-P data structure).
5. The goroutine is parked (`gopark`) with a wake-up reason of "sleep".
6. `sysmon` periodically checks the timer heap, or the scheduler picks the soonest timer on each scheduling round.
7. When the timer fires, the parked goroutine is added back to the runnable queue.
8. The scheduler picks it up and resumes execution after the `time.Sleep` call.

Reading this is not required. But it gives you confidence that `time.Sleep` is cheap and well-engineered — you can call it thousands of times per second without worry.

---

## Appendix E: A Tiny Retry "Library" You Can Drop In

Here is the smallest reusable retry helper that I would consider production-adjacent. It is a single file, no dependencies, ~50 lines:

```go
// Package retry provides a minimal exponential-backoff retry helper.
package retry

import (
	"errors"
	"fmt"
	"time"
)

// Permanent wraps an error to signal "do not retry".
type Permanent struct{ Err error }

func (p *Permanent) Error() string { return p.Err.Error() }
func (p *Permanent) Unwrap() error { return p.Err }

// IsPermanent reports whether err was marked Permanent.
func IsPermanent(err error) bool {
	var p *Permanent
	return errors.As(err, &p)
}

// Policy describes a retry schedule.
type Policy struct {
	MaxAttempts int
	Base        time.Duration
	MaxDelay    time.Duration
}

// Default returns a reasonable default policy.
func Default() Policy {
	return Policy{MaxAttempts: 5, Base: 100 * time.Millisecond, MaxDelay: 5 * time.Second}
}

// Do runs op, retrying with exponential backoff on transient failures.
// Mark a result as permanent (do not retry) by returning a *Permanent.
func Do(op func() error, p Policy) error {
	if p.MaxAttempts <= 0 {
		return errors.New("retry: MaxAttempts must be > 0")
	}
	var lastErr error
	for attempt := 0; attempt < p.MaxAttempts; attempt++ {
		err := op()
		if err == nil {
			return nil
		}
		if perm := (*Permanent)(nil); errors.As(err, &perm) {
			return perm.Err
		}
		lastErr = err
		if attempt < p.MaxAttempts-1 {
			d := p.Base * time.Duration(1<<attempt)
			if d > p.MaxDelay || d < 0 {
				d = p.MaxDelay
			}
			time.Sleep(d)
		}
	}
	return fmt.Errorf("after %d attempts: %w", p.MaxAttempts, lastErr)
}
```

You could ship this as `internal/retry/retry.go` in any project and never need anything else for basic retry. The middle level will extend it to context-aware sleep and jitter; the professional level will add metrics and tracing.

Two things to notice about the design:

1. **The `Permanent` wrapper is the *only* coordination between the caller and the retry loop on the question of "should I retry".** The caller decides, by wrapping or not. The loop does not have built-in classification of HTTP codes or anything else. This keeps the retry policy generic and the classification close to the data.
2. **The function is `func() error`, not a generic typed function.** This makes it easy to use — you capture variables in the closure if you need return values. Generics could make it `func() (T, error)` for type-safe return, but the cost is a more complex API.

Both choices are debatable. The point is: write small, then grow.

---

## Appendix F: A Decision Table

When in doubt, consult this table:

| Question | Answer |
|----------|--------|
| Operation is idempotent? | If yes, you may retry. If no, design idempotency first. |
| Error is a 4xx (not 429)? | Do not retry. Surface immediately. |
| Error is a 5xx or 429? | Retry, with exponential backoff. |
| Error is a network error? | Retry. |
| Operation is a write to a financial system? | Use idempotency keys before retrying. |
| You are retrying in a hot loop? | Re-design. Retry at the boundary, not the hot path. |
| You are retrying forever? | Add `maxAttempts`. |
| Your max delay can exceed 60 s? | Reconsider; users do not wait 60 s. |
| The user might cancel? | Use context-aware sleep (middle level). |

---

## Appendix G: Off-by-One Disambiguation

The most common bug-source in retry loops is off-by-one in attempt counting. Pin down which convention your code uses:

- **Convention A:** `attempt` starts at 1; `maxAttempts` is the total count including the first attempt. "5 attempts" means 1 original + 4 retries.
- **Convention B:** `attempt` starts at 0; `maxRetries` is the count *after* the first attempt. "5 retries" means 1 original + 5 retries.

Pick one and stick to it. Document in the function comment. In this file we use Convention A (attempt 0..N-1, total = N attempts).

A common confusion at code reviews:

```go
for i := 0; i < maxRetries; i++ {  // is this `maxRetries` or `maxAttempts`?
```

Rename to make it unambiguous: `maxAttempts` if it includes the original call, `maxExtraRetries` if it does not. Or `maxTotalAttempts`.

---

## Appendix H: The Difference Between Calling-Side and Server-Side Retry

This file is entirely about *calling-side* retry: your code calls a remote system, and you retry on failure. There is also *server-side* retry, where the server itself retries an internal operation. They are different:

- **Calling-side retry** sees a failure and retries the whole call. The remote server may have done partial work; the retry produces another call.
- **Server-side retry** is invisible to the caller. The server retries an internal step (e.g. a database write) without the caller seeing the failure.

Server-side retry is generally safer because the server has full context (the operation's state, the database transaction, the idempotency key). Calling-side retry is necessary when the server cannot do it for you.

In well-designed systems, *both* exist:

- The server has internal retry on transient infrastructure failures.
- The client has retry on network failures and server `5xx`s.

The two compose: a transient infrastructure blip is caught server-side; a complete server failover is caught client-side.

This file teaches the client side. For server-side, see chapters on background-job processing and message queues.

---

## Appendix I: Anti-Pattern Catalogue

A short tour of bad retry code, with diagnoses. We will revisit these in `find-bug.md` for exercise.

### Anti-pattern 1: the immediate retry loop

```go
for {
    if err := call(); err == nil { return nil }
}
```

No backoff. No max attempts. A failing dependency triggers an infinite CPU-bound spin in your process.

### Anti-pattern 2: log-and-retry forever

```go
for {
    if err := call(); err != nil {
        log.Print(err)
        time.Sleep(1 * time.Second)
        continue
    }
    return nil
}
```

Constant backoff and no exit. Logs flood during outage. The function never returns.

### Anti-pattern 3: nested retry

```go
err := retry.Do(func() error {
    return retry.Do(func() error {
        return innerCall()
    }, innerPolicy)
}, outerPolicy)
```

If outer is 5 attempts and inner is 5 attempts, you have 25 inner calls. Multiplication of retry budgets is one of the most dangerous patterns in distributed systems. Usually you want only the *outermost* layer to retry.

### Anti-pattern 4: retry then ignore

```go
_ = retry.Do(call, policy) // ignore error
```

If every retry fails, the caller has no idea. The function looks like a no-op success. Always handle the error.

### Anti-pattern 5: identical retries to a failing dependency from many places

If five different functions all retry against the same dependency, when that dependency fails you get 5× the load you intended. Centralise the retry in one client.

### Anti-pattern 6: retrying the `404`

```go
for attempt := 0; attempt < 5; attempt++ {
    resp, err := http.Get(url)
    if err == nil && resp.StatusCode == 200 { return ... }
    time.Sleep(...)
}
```

A 404 also fails `resp.StatusCode == 200`, so you retry it. Five wasted attempts.

### Anti-pattern 7: re-creating the request inside the loop

```go
for attempt := 0; attempt < 5; attempt++ {
    body := buildBody()  // expensive!
    err := postIt(body)
    if err == nil { return nil }
    time.Sleep(...)
}
```

If `buildBody` is expensive (parsing, marshalling), do it once outside the loop.

But: be careful if the body is consumable (e.g. `io.Reader`). For HTTP, you need a fresh body each retry, or you need to seek the reader back. The trick is to keep the *bytes* outside the loop, and create a new `*http.Request` each iteration. We will show this in `middle.md`.

### Anti-pattern 8: ignoring the response body

```go
for attempt := 0; attempt < 5; attempt++ {
    resp, _ := http.Get(url)
    if resp != nil && resp.StatusCode == 200 { return nil }
    // forgot resp.Body.Close()
}
```

Five leaked HTTP connections per failed retry sequence.

### Anti-pattern 9: very long base delay

```go
const base = 5 * time.Second
const maxAttempts = 5
```

Worst case sleep: `5s * 31 = 155s ≈ 2.5 minutes`. No user waits that long. Either drop attempts or drop the base.

### Anti-pattern 10: incrementing the delay manually

```go
delay := base
for attempt := 0; attempt < 5; attempt++ {
    // ...
    time.Sleep(delay)
    delay *= 2
}
```

This works, but it is harder to reason about and prone to off-by-one. Prefer recomputing from `attempt` each iteration.

---

## Appendix J: Pointer to the Rest of the Section

If you have read everything to here, you have the junior-level grasp on the topic. The next file (`middle.md`) introduces:

- **Jitter** — full, equal, and decorrelated variants — to break lockstep retries.
- **Context** — making the loop responsive to cancellation and deadlines.
- **Retry budget** — a system-wide cap on retry traffic.
- **The fake clock** — testing retries without sleeping.
- **Composable retry policies** — `Backoff` interface, `MaxRetries` decorator, etc.

The exercises in `tasks.md`, bug hunt in `find-bug.md`, and optimisation problems in `optimize.md` use the patterns from both files. Tackle them after middle.

---

## Final Exercises (Junior)

Pick three or four to actually code. Solutions in `tasks.md`.

1. Write `retry.Do(op func() error, n int, base, max time.Duration) error` from memory. No reference.
2. Modify it to return `(int attempts, error)`.
3. Add the `Permanent` wrapper.
4. Wrap `http.Get` so callers do not see retries.
5. Write a table-driven test for the backoff schedule.
6. Trace by hand: with `base = 200ms`, `maxDelay = 2s`, `maxAttempts = 6`, what is the worst-case total sleep?
7. Reproduce the integer-overflow bug at `attempt = 63`.
8. Reproduce the leaked-body bug.
9. Implement the `Retry-After` header parser.
10. Convert one inline retry loop in an open-source Go project to use a helper.

Once you can do these without looking, you are ready for `middle.md`.

---

## Appendix K: A Closer Look at HTTP Retries

HTTP retry is the case the rest of this section keeps coming back to, because it is the most common. Let us look at the moving parts in more detail.

### What can fail in an HTTP call?

A single `http.Get(url)` can fail at many stages:

1. **DNS lookup.** "no such host". Sometimes transient (server warming up DNS cache); sometimes permanent (typo in the URL).
2. **TCP dial.** "connection refused" (server not listening), "i/o timeout" (server too slow to accept). Usually transient.
3. **TLS handshake.** "x509: certificate signed by unknown authority" (permanent). "i/o timeout" during handshake (transient).
4. **HTTP request write.** "broken pipe" (server closed mid-send). Transient.
5. **HTTP response read.** "unexpected EOF" (server died mid-response). Transient.
6. **HTTP status code.** 1xx through 5xx; the only "success" in our sense is 2xx.

Each stage may produce a different error type. The `net/http` package wraps most of them into `*url.Error`. You can unwrap to look at the underlying network error.

```go
import (
    "errors"
    "net"
    "net/url"
)

func classifyHTTPError(err error) (retryable bool) {
    if err == nil {
        return false
    }
    var urlErr *url.Error
    if errors.As(err, &urlErr) {
        var netErr net.Error
        if errors.As(urlErr.Err, &netErr) {
            return true // network-level, retryable
        }
    }
    return false
}
```

Adding more cases:

```go
import "syscall"

func classifyHTTPError(err error) (retryable bool) {
    if err == nil { return false }
    if errors.Is(err, syscall.ECONNREFUSED) { return true }
    if errors.Is(err, syscall.ECONNRESET) { return true }
    if errors.Is(err, syscall.ETIMEDOUT) { return true }
    return false
}
```

For brevity, in this file we mostly say "any network error is retryable" and treat the rest by status code. In `professional.md` we will refine.

### Connection reuse

Go's default `http.Transport` keeps connections alive (HTTP keep-alive). When you retry, your second attempt may use a cached connection — which is great if the connection is healthy, terrible if the original failure was because the connection died.

For retries that are "the server returned 503", reusing the connection is fine.
For retries that are "i/o timeout on a write", the connection should be discarded.

Go usually handles this for you: a broken connection is closed and not returned to the pool. But there are edge cases. If you suspect connection-reuse issues during retry, set `Transport.DisableKeepAlives = true` and see if behaviour changes.

### Request bodies and retry

If your request has a body — e.g. `POST` with JSON — you have to be careful. The body is an `io.Reader`. After the first request consumes it, the reader is at EOF. The retry sends an empty body. Result: confusing failures.

Fix: read the body into a `[]byte` *before* the loop, and create a new `bytes.NewReader` per attempt:

```go
data, err := io.ReadAll(originalBody)
if err != nil { return err }

for attempt := 0; attempt < maxAttempts; attempt++ {
    req, _ := http.NewRequest("POST", url, bytes.NewReader(data))
    req.Header.Set("Content-Type", "application/json")
    resp, err := client.Do(req)
    // ...
}
```

This is one of the surprises that bites people the first time. `cenkalti/backoff` and similar libraries have helpers; or you remember the pattern.

### Timeouts vs deadlines

The `http.Client.Timeout` is a *per-call* timeout, not a total. Each retry attempt has its own 10-second budget. If you set `maxAttempts = 5`, your total wall-clock can be `5 * 10s = 50s` of call latency, plus all the backoff sleeps.

If you want a *total* deadline across all retries, use `context.WithTimeout` on a parent context and check `ctx.Err()` between retries. We will do this in `middle.md`.

For now, remember: timeout-per-call is local to each attempt; the loop multiplies the worst case.

---

## Appendix L: The Smallest Possible Tests

Tests that exercise a retry loop are tricky because they involve `time.Sleep`. You have three options:

1. **Use tiny durations.** `base = 1*time.Millisecond, maxDelay = 10*time.Millisecond`. The test still actually sleeps, but only milliseconds.
2. **Pass in a sleeper.** Make the helper take a `sleep func(time.Duration)` parameter. The test passes a no-op.
3. **Use a fake clock library.** `clockwork.NewFakeClock()` or `clock.Mock`. The most flexible but adds a dependency.

For junior code, option 1 is fine. Most retry tests fit on one screen and run in under 100 ms total even with real sleep.

### A complete table-driven test

```go
package retry_test

import (
	"errors"
	"strings"
	"testing"
	"time"

	"yourmodule/retry"
)

func TestDo(t *testing.T) {
	cases := []struct {
		name        string
		op          func(*int) func() error
		policy      retry.Policy
		wantCalls   int
		wantErr     string
	}{
		{
			name: "success first try",
			op: func(count *int) func() error {
				return func() error {
					*count++
					return nil
				}
			},
			policy:    retry.Policy{MaxAttempts: 5, Base: 1 * time.Millisecond, MaxDelay: 10 * time.Millisecond},
			wantCalls: 1,
			wantErr:   "",
		},
		{
			name: "success third try",
			op: func(count *int) func() error {
				return func() error {
					*count++
					if *count < 3 {
						return errors.New("transient")
					}
					return nil
				}
			},
			policy:    retry.Policy{MaxAttempts: 5, Base: 1 * time.Millisecond, MaxDelay: 10 * time.Millisecond},
			wantCalls: 3,
			wantErr:   "",
		},
		{
			name: "exhaust",
			op: func(count *int) func() error {
				return func() error {
					*count++
					return errors.New("always fails")
				}
			},
			policy:    retry.Policy{MaxAttempts: 3, Base: 1 * time.Millisecond, MaxDelay: 10 * time.Millisecond},
			wantCalls: 3,
			wantErr:   "after 3 attempts",
		},
		{
			name: "permanent surfaces immediately",
			op: func(count *int) func() error {
				return func() error {
					*count++
					return &retry.Permanent{Err: errors.New("nope")}
				}
			},
			policy:    retry.Policy{MaxAttempts: 5, Base: 1 * time.Millisecond, MaxDelay: 10 * time.Millisecond},
			wantCalls: 1,
			wantErr:   "nope",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var count int
			err := retry.Do(tc.op(&count), tc.policy)
			if count != tc.wantCalls {
				t.Errorf("calls: got %d, want %d", count, tc.wantCalls)
			}
			if tc.wantErr == "" {
				if err != nil {
					t.Errorf("err: got %v, want nil", err)
				}
			} else {
				if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
					t.Errorf("err: got %v, want substring %q", err, tc.wantErr)
				}
			}
		})
	}
}
```

The table covers four cases: success on first try, success on third try, exhaustion, and permanent. With `base = 1*time.Millisecond`, the whole test runs in a few milliseconds. Every retry library should have something like this.

---

## Appendix M: A Tour of Real Production Retry Code

Let us look at how three open-source projects handle retry, at the junior level (just the shape, not the details). This gives you context for what production looks like.

### Project 1: AWS SDK for Go (v2)

The AWS SDK uses a middleware stack. Retry is one middleware. Its policy:

- Up to 3 attempts by default (configurable).
- Exponential backoff with jitter ("full jitter" by default).
- Per-call retry budget tracked at the client level.
- Respects `Retry-After` from S3.

Source: `aws/retry/standard.go` in `github.com/aws/aws-sdk-go-v2`.

The shape of `Standard.Retry` (paraphrased):

```go
func (s *Standard) IsErrorRetryable(err error) bool { /* ... */ }
func (s *Standard) MaxAttempts() int { return s.maxAttempts }
func (s *Standard) RetryDelay(attempt int, err error) (time.Duration, error) { /* full jitter */ }
```

We will replicate the full-jitter formula in `middle.md`.

### Project 2: gRPC Go client

gRPC retries are configured by *service config* — a JSON document that describes the policy per method. The client-side code reads this and applies a retry decorator.

Default: no retry. You opt in by setting `retryPolicy` in your service config:

```json
{
  "methodConfig": [{
    "name": [{"service": "MyService", "method": "DoIt"}],
    "retryPolicy": {
      "maxAttempts": 4,
      "initialBackoff": "0.1s",
      "maxBackoff": "1s",
      "backoffMultiplier": 2.0,
      "retryableStatusCodes": ["UNAVAILABLE"]
    }
  }]
}
```

gRPC uses *full jitter* internally and has explicit retry throttling to prevent storms.

### Project 3: `cenkalti/backoff`

This is the most popular standalone Go retry library. The high-level API:

```go
op := func() error { return callRemote() }
err := backoff.Retry(op, backoff.NewExponentialBackOff())
```

Defaults of `NewExponentialBackOff`:

- `InitialInterval = 500 * time.Millisecond`
- `RandomizationFactor = 0.5` (jitter)
- `Multiplier = 1.5`
- `MaxInterval = 60 * time.Second`
- `MaxElapsedTime = 15 * time.Minute`

We will dissect this library in `professional.md` (it deserves a section to itself).

For now, the shape is enough: production retry libraries have all the same parts — schedule, jitter, cap, budget — and the differences are in defaults and naming.

---

## Appendix N: When NOT to Retry

A short list of cases where retry is the wrong tool:

1. **The caller of the caller will already retry.** If your function is part of a request-handler pipeline and the client is going to retry the whole request, you adding internal retry just multiplies traffic.
2. **The dependency is known to be down.** Use a circuit breaker. We cover this in `professional.md`.
3. **You are inside a database transaction.** Long retries lock rows for long times. Move the retry outside the transaction.
4. **The error is `context.Canceled`.** The caller has given up; do not waste their time.
5. **The error is `context.DeadlineExceeded`.** The deadline has passed; retrying gets you nowhere.
6. **You are calling a non-idempotent endpoint without an idempotency key.**
7. **The dependency cost-per-call is non-trivial.** SMS sends, paid API calls, expensive ML inference. Retry blindly and your bill grows.
8. **You are in a hot loop.** Retries belong at the boundary.

If you find yourself adding retry to fix a flakiness problem, ask: *should the underlying system be more reliable instead?* Retry is a Band-Aid; the real fix is upstream.

---

## Appendix O: A Mini-Reference of the Identifiers Used

| Identifier | Type | Meaning |
|------------|------|---------|
| `base` | `time.Duration` | The delay before the first retry. |
| `attempt` | `int` | How many attempts have failed so far. Indexed from 0. |
| `maxAttempts` | `int` | The cap on total attempts. |
| `maxDelay` | `time.Duration` | The cap on any single delay. |
| `factor` | `float64` | The multiplier in `base * factor^attempt`. Conventionally 2. |
| `delay` | `time.Duration` | The wait before the *next* attempt. |
| `op` | `func() error` | The function being retried. |
| `policy` | `retry.Policy` | The bundle of `MaxAttempts`, `Base`, `MaxDelay`. |
| `lastErr` | `error` | The error from the most recent failed attempt. |
| `retryable` | `bool` | Whether an error should be retried. |

Keep these consistent across your codebase. If your retry helper calls them `Tries` and `Interval`, refactor.

---

## Appendix P: A Five-Minute Build

Make a `playground` directory. Inside, three files:

```
playground/
  main.go
  retry/retry.go
  retry/retry_test.go
```

`retry/retry.go` contains the package from Appendix E above.

`retry/retry_test.go` contains the table-driven test from Appendix L above.

`main.go` looks like:

```go
package main

import (
	"errors"
	"fmt"
	"math/rand"
	"time"

	"playground/retry"
)

func flakey() error {
	if rand.Float64() < 0.3 {
		return nil
	}
	return errors.New("transient")
}

func main() {
	rand.Seed(time.Now().UnixNano())
	err := retry.Do(flakey, retry.Policy{
		MaxAttempts: 8,
		Base:        50 * time.Millisecond,
		MaxDelay:    1 * time.Second,
	})
	if err != nil {
		fmt.Println("failed:", err)
		return
	}
	fmt.Println("succeeded")
}
```

Run:

```
go test ./retry/...
go run ./...
```

Both should work. You now have a tiny but real retry library and you have written and tested it. Congratulations.

---

## Appendix Q: A Friendly Warning

A retry loop *will* eventually bite you. The bite usually takes the form of:

1. A production incident where retries amplified an outage.
2. A bill from a SaaS provider that included thousands of duplicate API calls.
3. A user complaint that "the page hung for two minutes".

These are *normal* incidents. They happen to every engineer who works with networked services. The lesson is not "do not retry"; it is "retry carefully, with caps, with backoff, with classification, and with observability".

If you find yourself in such an incident, the fix is almost always:

- Add a max-attempts cap.
- Add jitter.
- Add idempotency keys.
- Add a circuit breaker.
- Surface the error to the user faster.

All four of those are covered in the next three files. Read them.

---

That is the junior level. Move on to `middle.md` when you can write the retry helper from memory and explain why every line is there.



