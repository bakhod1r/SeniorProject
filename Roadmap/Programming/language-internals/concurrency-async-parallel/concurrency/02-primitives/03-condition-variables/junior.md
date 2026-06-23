# Condition Variables — Junior Level

> **Topic:** [Condition Variables](README.md)
> **Focus:** wait/signal, predicate-in-a-loop, monitor pattern

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
11. [Clean Code](#clean-code)
12. [Best Practices](#best-practices)
13. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
14. [Common Mistakes](#common-mistakes)
15. [Tricky Points](#tricky-points)
16. [Test Yourself](#test-yourself)
17. [Tricky Questions](#tricky-questions)
18. [Cheat Sheet](#cheat-sheet)
19. [Summary](#summary)
20. [What You Can Build](#what-you-can-build)
21. [Further Reading](#further-reading)
22. [Related Topics](#related-topics)
23. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

When two threads share data, a mutex is enough to keep them from stepping on each other. But mutexes only answer the question "is anyone else inside the critical section right now?" They cannot answer "has the queue become non-empty?" or "is it my turn to drink from the coffee pot?". For those questions, you need a way for a thread to say, "I want to go to sleep until something interesting happens — and please wake me up when it does." That is the job of a **condition variable**.

A condition variable is one of the oldest and most fundamental synchronization primitives. It is not a lock. It does not protect data. It does not have an "owner". A condition variable is, on its own, almost nothing — a list of sleeping threads waiting for a notification. What makes it powerful is the way it cooperates with a mutex: when a thread calls `wait` on a condition variable, the runtime atomically releases the mutex and puts the thread to sleep. When another thread later changes the shared state under that same mutex and calls `signal` or `broadcast`, one or all of the sleeping threads wake up, re-acquire the mutex, and check whether the condition they were waiting for has finally become true.

You will meet condition variables in every serious threading library: pthreads (`pthread_cond_t`), Java (`Object.wait/notify` and `java.util.concurrent.locks.Condition`), C++ (`std::condition_variable`), Python (`threading.Condition`), Go (`sync.Cond`), Rust (`std::sync::Condvar`). Although the syntax differs, the underlying idea is identical, and the same correctness rules apply everywhere: **always hold the mutex while waiting and signalling**, **always check the predicate in a loop**, and **never assume that a wakeup means the condition is true**.

At the junior level, your goal is to understand the three operations (`wait`, `signal`, `broadcast`), why they pair with a mutex, what a "spurious wakeup" is and why it is allowed, and how to use the canonical `while (!predicate) cond.wait(lock)` pattern correctly. Once you can write a bounded producer–consumer buffer using one mutex and two condition variables without deadlocking, losing wakeups, or busy-waiting, you have understood condition variables.

This page walks you through the model, the rules, and the patterns. The middle and senior pages dig into wait-morphing, fairness, futex implementation, and how `sync.Cond` differs from channels. For now, we focus on the basics — but the basics, done right, will save you from the most expensive bugs in concurrent code.

---

## Prerequisites

Before reading this page, you should be comfortable with the following:

- **Threads.** What a thread is, how to spawn one, how `join` works. See `../../01-foundations/02-thread-vs-process/junior.md`.
- **Race conditions.** What it means for two threads to read and write the same variable without synchronization. See `../../01-foundations/04-race-conditions/junior.md`.
- **Mutexes.** Mutual exclusion, critical sections, RAII / `with` / `defer` patterns for unlocking. See `../01-mutex/junior.md`.
- **Atomicity.** The intuition that some operations are indivisible from the point of view of other threads.
- **Basic OS scheduling.** That threads can be runnable, running, or blocked, and that the kernel decides who runs next.

You do not need to know about futexes, lock-free programming, memory models, or fairness algorithms. Those come at the middle and senior levels.

You should also have a working development setup for at least one of: C/C++ with pthreads, Java, Python 3, Go, or Rust. The code examples below use all five so you can pick whichever feels most natural.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Condition variable** | A synchronization primitive that lets threads sleep until notified by another thread. It owns no data and is always used together with a mutex. Also called a "condvar" or "cv". |
| **Wait** | The operation that atomically releases the associated mutex and suspends the calling thread on the condvar's wait queue. When the thread is later woken, it re-acquires the mutex before returning. APIs: `pthread_cond_wait`, `Object.wait`, `cv.wait`, `cond.Wait`, `Condvar::wait`. |
| **Signal / notify_one** | Wakes **one** thread that is currently waiting on the condvar. If no threads are waiting, the signal is lost. APIs: `pthread_cond_signal`, `Object.notify`, `cv.notify_one`, `cond.Signal`, `Condvar::notify_one`. |
| **Broadcast / notify_all** | Wakes **all** threads currently waiting on the condvar. Used when the state change may satisfy multiple waiters or when waiters are checking different predicates. APIs: `pthread_cond_broadcast`, `Object.notifyAll`, `cv.notify_all`, `cond.Broadcast`, `Condvar::notify_all`. |
| **Predicate** | The boolean expression a thread is waiting to become true (for example, `queue.size() > 0`). The predicate is evaluated under the mutex. |
| **Spurious wakeup** | A wakeup that occurs even though no thread called `signal` or `broadcast`. Allowed by every major implementation. The reason we always re-check the predicate in a loop. |
| **Monitor** | A higher-level pattern (Hoare, Brinch Hansen) in which an object's data is protected by a single mutex and one or more condition variables, and all access happens through methods that acquire the mutex on entry. Modern condvars are the building block of this pattern. |
| **Hoare semantics** | A signalling discipline in which the signaller hands the mutex directly to the woken waiter. The waiter is guaranteed to see the predicate as true. Rare in practice. |
| **Mesa semantics** | The dominant discipline in which `signal` only marks a waiter as runnable; the waiter must re-acquire the mutex and re-check the predicate, because another thread may run first. All mainstream languages use Mesa semantics. |
| **Lost wakeup** | A bug where `signal` is called while no thread is waiting and the state change goes unnoticed, leaving a future waiter blocked forever. Usually caused by setting state without holding the mutex, or by signalling before any thread has reached `wait`. |
| **Thundering herd** | The pattern where `broadcast` wakes many threads but only one can make progress; the rest re-check the predicate, find it false, and go back to sleep. Wasteful but correct. |

---

## Core Concepts

### The wait/signal/broadcast pattern

A condition variable supports three operations:

1. **`wait(mutex)`** — called by a thread that already holds `mutex`. The thread is added to the condvar's wait queue, the mutex is released, and the thread is put to sleep. When the thread is later woken (by a signal, broadcast, or spurious wakeup), it re-acquires the mutex before `wait` returns.
2. **`signal()` (a.k.a. `notify_one`)** — moves one thread from the condvar's wait queue to the runnable state. If no threads are waiting, nothing happens; the signal is lost.
3. **`broadcast()` (a.k.a. `notify_all`)** — moves all waiting threads to the runnable state. They will then race for the mutex; only one at a time will hold it.

The canonical use pattern is:

```text
acquire(mutex)
while not predicate:
    cond.wait(mutex)     # atomically: release mutex, sleep, re-acquire mutex
# now predicate is true, do work
release(mutex)
```

And from the side that changes the state:

```text
acquire(mutex)
modify shared state
cond.signal()            # or broadcast()
release(mutex)
```

That is essentially all there is to a condition variable. Everything else — fairness, spurious wakeups, semantics — is detail on top of that pattern.

### Why a condvar always pairs with a mutex

A condition variable on its own is racy. Imagine the following without a mutex:

1. Consumer: `if (queue.empty()) cv.wait();`
2. Producer: pushes an item, calls `cv.signal()`.

The two steps inside the consumer are not atomic. The scheduler could run them in this order:

1. Consumer checks `queue.empty()` — true.
2. *(context switch)* Producer pushes item and calls `cv.signal()`. No one is waiting; signal is lost.
3. Consumer calls `cv.wait()` — sleeps forever.

This is the **lost wakeup** problem. The mutex solves it by making "check predicate" and "go to sleep" atomic from the producer's point of view: the producer cannot push the item and signal until the consumer either holds the mutex (and is therefore not yet waiting, but will check the predicate after acquiring) or is sleeping inside `wait` (which has released the mutex). There is no in-between state where the consumer has checked the predicate but is not yet waiting.

That is why every condvar API takes a mutex either implicitly (Java's intrinsic locks) or explicitly (`pthread_cond_wait(&cv, &mu)`, `cv.wait(lock)`). **The mutex is not optional.**

### The atomic release-and-wait property

The defining property of `wait` is **atomic release-and-sleep**. The operation:

```
release mutex; go to sleep on cv
```

must be performed atomically with respect to any other thread that might signal the condvar. If the release and the sleep were two separate, observable steps, you would have a lost wakeup window between them.

The runtime guarantees this atomicity. Internally, the wait operation typically goes like this (simplified):

1. Acquire the condvar's internal queue lock.
2. Add the calling thread to the wait queue.
3. Release the user-visible mutex.
4. Suspend the thread (atomically with respect to the queue lock).
5. On wakeup, re-acquire the user-visible mutex.
6. Return.

The user does not see steps 1–5; they only see `wait()` as a single call. But the property to remember is: **no signal can be lost between when you decide to wait and when you actually sleep**, because the mutex you hold blocks any state-changing thread from running until you are safely on the queue.

### Spurious wakeups; the always-check-in-loop rule

`wait` can return even when nobody called `signal` or `broadcast`. This is called a **spurious wakeup**. It is not a bug; it is an explicit licence given to implementers because some hardware and OS primitives (futexes, EINTR, etc.) make spurious wakeups very hard to avoid without performance cost.

Therefore the universal rule is: **always check the predicate in a `while` loop**, never an `if`.

```c
// WRONG
if (queue_empty(&q)) {
    pthread_cond_wait(&not_empty, &mu);
}
item = dequeue(&q);   // q might still be empty!

// CORRECT
while (queue_empty(&q)) {
    pthread_cond_wait(&not_empty, &mu);
}
item = dequeue(&q);
```

The loop also protects against a second case: even with Mesa semantics (see below), another thread might have grabbed the item between the signal and your re-acquisition of the mutex. So you must re-check anyway. The loop handles all three cases — spurious wakeups, stolen wakeups, and irrelevant broadcasts — uniformly.

### Hoare vs Mesa semantics (modern languages mostly Mesa)

There are two historical disciplines for what happens when a thread signals a condition variable:

- **Hoare semantics.** The signaller immediately hands the mutex to one specific waiter, which runs next. The waiter is guaranteed to see the predicate as true. The signaller resumes once the waiter releases the mutex. Elegant but expensive and rarely implemented.
- **Mesa semantics.** The signaller just marks a waiter as runnable and continues running with the mutex held. The waiter eventually re-acquires the mutex, but by then another thread may have changed the state. The waiter **must re-check** the predicate.

Every mainstream language uses Mesa semantics: pthreads, Java, C++, Go, Rust, Python. This is why the `while (!predicate)` loop is mandatory and why "I just got a wakeup so the condition must hold" is wrong reasoning.

### The monitor pattern as the foundation

A **monitor** is a higher-level construct: a class whose data is protected by a single mutex, with one or more condition variables for state-based waiting. Methods acquire the mutex on entry and release it on exit. Inside, they may `wait` and `signal` on the condition variables to coordinate.

Modern languages give you the raw materials (mutex + condvar) and let you build monitors yourself. Java's `synchronized` methods plus `wait`/`notify` are a direct implementation of Hoare's monitor concept (with Mesa semantics). C++'s `std::mutex` + `std::condition_variable` are the same building blocks. Even `sync.Cond` in Go and `Condvar` in Rust follow the same template.

Whenever you find yourself thinking, "I have shared state, and threads need to wait until that state changes," you are reaching for a monitor. The implementation is: one mutex, one or more condvars, and methods that always acquire the mutex first.

### Wait with timeout

Most APIs provide a timed wait: `pthread_cond_timedwait`, `cv.wait_for(lock, dur)`, `Condition.await(time, unit)`. The semantics are:

- Behave like `wait`, but also wake up if the timeout elapses.
- After waking, you still need to check the predicate (and possibly the timeout result) to decide what to do.

Pattern:

```cpp
auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
std::unique_lock<std::mutex> lk(mu);
while (!ready) {
    if (cv.wait_until(lk, deadline) == std::cv_status::timeout) {
        if (!ready) {
            return TimedOut;
        }
        // else: ready became true at almost the same moment; fall through
    }
}
```

Timed waits are how you implement bounded retries, deadlines, and "give up after N seconds" semantics. Never use `sleep` to poll a condition; always use a timed wait so the producer's signal can wake you immediately.

### Broadcast vs signal: when to wake all vs one

This is the most common point of confusion at the junior level. Use **signal** when:

- Only one waiter can make progress per state change.
- All waiters are waiting on the same predicate.
- The waiters are interchangeable (any one can handle the work).

A classic example: a queue of work items. One push, one item, one consumer can wake. `signal` is enough.

Use **broadcast** when:

- The state change may unblock more than one waiter (for example, a barrier releases all threads at once).
- Different waiters are checking different predicates on the same condition variable.
- You change a global state that affects every waiter (for example, `done = true` on shutdown).
- You are unsure which waiter the change applies to. (Correct but possibly wasteful.)

A useful rule of thumb: **when in doubt, broadcast**. It is always correct (the `while` loop will resort it out), it is just less efficient. `signal` is an optimisation you should apply when you can prove only one waiter needs to wake.

---

## Real-World Analogies

### The waiting room

Imagine a doctor's office. The waiting room has chairs (the condvar wait queue), and the receptionist's desk is protected by a velvet rope (the mutex). You walk in, ask the receptionist whether the doctor is free (check the predicate), and if not, you sit down in the waiting room. To sit down, you have to leave the desk so other patients can ask their own questions — that is the "release the mutex" part. You doze off (sleep on the condvar).

Eventually the doctor finishes with someone and tells the receptionist to call the next patient. The receptionist (signal) calls one name. That patient wakes up, walks back to the desk, and re-checks: "is the doctor free now?" — because in the time it took them to walk over, another emergency might have arrived. If the doctor is free, great. If not, back to the chair.

A broadcast would be the fire alarm: everyone wakes up and goes to check the situation. Most discover it doesn't apply to them and sit back down. Wasteful but safe.

### The restaurant pager

You order food at a busy restaurant and they hand you a vibrating pager. You sit anywhere you like (you don't busy-wait at the counter). When your food is ready, the kitchen presses a button (signal) and your pager buzzes. You walk back to the counter and check: "is my order ready?" — sometimes someone else's order is ready first, sometimes the staff is still plating, sometimes you got buzzed by mistake. So you still verify before walking away with food. The pager is a spurious-wakeup-tolerant condvar; the counter is the mutex.

The "broadcast" version is the manager yelling "ORDERS UP" to everyone in the restaurant. Everyone walks to the counter and checks if their order is ready.

---

## Mental Models

**Model 1: A doorbell for sleeping threads.** The mutex is the door. The condvar is the doorbell. You don't ring the doorbell unless you have something to say (you changed state under the mutex). When the doorbell rings, the sleeper wakes, walks to the door, opens it (acquires the mutex), and checks whether the news is relevant.

**Model 2: A change-notification channel that loses unread messages.** Condvars are not queues. A signal sent when no one is waiting is **lost**. If you need persistent notification, you need a flag (under the mutex) plus the condvar; the flag survives between signals, and `wait` only sleeps when the flag is false.

**Model 3: A blocking version of "check predicate".** Read `while (!P) cv.wait(m)` as "wait until P is true, releasing the mutex while you wait." The condvar is the mechanism that makes the waiting efficient (no busy loop) and correct (no lost wakeups).

**Model 4: The monitor's nervous system.** The mutex is the monitor's skin (protects its state). The condvar is its nervous system (lets it sleep and wake up). Neither alone is enough; together they let an object coordinate with the world.

---

## Code Examples

We will implement the same **bounded producer-consumer buffer** in five languages. The buffer has a fixed capacity. Producers wait when the buffer is full; consumers wait when the buffer is empty. We use one mutex and two condition variables (`not_full`, `not_empty`).

### C / C++ with pthreads

```c
// bounded_buffer.c
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

#define CAP 4

typedef struct {
    int items[CAP];
    int head, tail, count;
    pthread_mutex_t mu;
    pthread_cond_t not_full;
    pthread_cond_t not_empty;
} bbuf_t;

void bbuf_init(bbuf_t *b) {
    b->head = b->tail = b->count = 0;
    pthread_mutex_init(&b->mu, NULL);
    pthread_cond_init(&b->not_full, NULL);
    pthread_cond_init(&b->not_empty, NULL);
}

void bbuf_put(bbuf_t *b, int v) {
    pthread_mutex_lock(&b->mu);
    while (b->count == CAP) {
        pthread_cond_wait(&b->not_full, &b->mu);
    }
    b->items[b->tail] = v;
    b->tail = (b->tail + 1) % CAP;
    b->count++;
    pthread_cond_signal(&b->not_empty);   // wake one consumer
    pthread_mutex_unlock(&b->mu);
}

int bbuf_get(bbuf_t *b) {
    pthread_mutex_lock(&b->mu);
    while (b->count == 0) {
        pthread_cond_wait(&b->not_empty, &b->mu);
    }
    int v = b->items[b->head];
    b->head = (b->head + 1) % CAP;
    b->count--;
    pthread_cond_signal(&b->not_full);    // wake one producer
    pthread_mutex_unlock(&b->mu);
    return v;
}

static bbuf_t buf;

void *producer(void *arg) {
    for (int i = 0; i < 10; i++) {
        bbuf_put(&buf, i);
        printf("produced %d\n", i);
        usleep(10000);
    }
    return NULL;
}

void *consumer(void *arg) {
    for (int i = 0; i < 10; i++) {
        int v = bbuf_get(&buf);
        printf("consumed %d\n", v);
        usleep(15000);
    }
    return NULL;
}

int main(void) {
    bbuf_init(&buf);
    pthread_t p, c;
    pthread_create(&p, NULL, producer, NULL);
    pthread_create(&c, NULL, consumer, NULL);
    pthread_join(p, NULL);
    pthread_join(c, NULL);
    return 0;
}
```

Compile with `cc -O2 -pthread bounded_buffer.c -o bbuf`. Notice the `while` loops, the two condvars, and the fact that we hold the mutex while signalling. (Some pthread tutorials suggest signalling after unlock for performance — both are correct, but signalling under the lock is easier to reason about.)

### Java (intrinsic monitor)

```java
// BoundedBuffer.java
import java.util.ArrayDeque;
import java.util.Deque;

public class BoundedBuffer<T> {
    private final Deque<T> q = new ArrayDeque<>();
    private final int cap;
    private final Object lock = new Object();

    public BoundedBuffer(int cap) { this.cap = cap; }

    public void put(T item) throws InterruptedException {
        synchronized (lock) {
            while (q.size() == cap) {
                lock.wait();           // releases lock, sleeps, re-acquires
            }
            q.addLast(item);
            lock.notifyAll();          // wake any waiter (put or take)
        }
    }

    public T take() throws InterruptedException {
        synchronized (lock) {
            while (q.isEmpty()) {
                lock.wait();
            }
            T item = q.removeFirst();
            lock.notifyAll();
            return item;
        }
    }

    public static void main(String[] args) throws Exception {
        BoundedBuffer<Integer> buf = new BoundedBuffer<>(4);
        Thread p = new Thread(() -> {
            for (int i = 0; i < 10; i++) {
                try { buf.put(i); System.out.println("put " + i); Thread.sleep(10); }
                catch (InterruptedException ignored) {}
            }
        });
        Thread c = new Thread(() -> {
            for (int i = 0; i < 10; i++) {
                try { System.out.println("got " + buf.take()); Thread.sleep(15); }
                catch (InterruptedException ignored) {}
            }
        });
        p.start(); c.start(); p.join(); c.join();
    }
}
```

Java's intrinsic monitor gives every object a built-in mutex (`synchronized`) and one anonymous condition variable (`wait`/`notify`/`notifyAll`). Here we use `notifyAll` for safety: since both producers and consumers wait on the same lock, `notify` could wake the wrong kind of thread. For finer control, use `java.util.concurrent.locks.ReentrantLock` with named `Condition` objects (`notFull`, `notEmpty`).

### Python (`threading.Condition`)

```python
# bounded_buffer.py
import threading
import time
from collections import deque

class BoundedBuffer:
    def __init__(self, cap):
        self.cap = cap
        self.q = deque()
        self.cond = threading.Condition()   # built-in mutex + condvar

    def put(self, item):
        with self.cond:
            while len(self.q) == self.cap:
                self.cond.wait()
            self.q.append(item)
            self.cond.notify_all()

    def take(self):
        with self.cond:
            while not self.q:
                self.cond.wait()
            item = self.q.popleft()
            self.cond.notify_all()
            return item

def producer(buf):
    for i in range(10):
        buf.put(i)
        print(f"put {i}")
        time.sleep(0.01)

def consumer(buf):
    for _ in range(10):
        v = buf.take()
        print(f"got {v}")
        time.sleep(0.015)

if __name__ == "__main__":
    buf = BoundedBuffer(4)
    t1 = threading.Thread(target=producer, args=(buf,))
    t2 = threading.Thread(target=consumer, args=(buf,))
    t1.start(); t2.start()
    t1.join(); t2.join()
```

`threading.Condition` wraps a `Lock` and a condition variable in one object. The `with self.cond:` block acquires the lock; `wait()` releases it and sleeps; `notify_all()` wakes everyone. The `while` loop around the predicate is, as always, mandatory.

### Go (`sync.Cond`)

```go
// bounded_buffer.go
package main

import (
	"fmt"
	"sync"
	"time"
)

type BoundedBuffer struct {
	mu       sync.Mutex
	notFull  *sync.Cond
	notEmpty *sync.Cond
	q        []int
	cap      int
}

func NewBoundedBuffer(cap int) *BoundedBuffer {
	b := &BoundedBuffer{cap: cap, q: make([]int, 0, cap)}
	b.notFull = sync.NewCond(&b.mu)
	b.notEmpty = sync.NewCond(&b.mu)
	return b
}

func (b *BoundedBuffer) Put(v int) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for len(b.q) == b.cap {
		b.notFull.Wait()
	}
	b.q = append(b.q, v)
	b.notEmpty.Signal()
}

func (b *BoundedBuffer) Get() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	for len(b.q) == 0 {
		b.notEmpty.Wait()
	}
	v := b.q[0]
	b.q = b.q[1:]
	b.notFull.Signal()
	return v
}

func main() {
	buf := NewBoundedBuffer(4)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for i := 0; i < 10; i++ {
			buf.Put(i)
			fmt.Println("put", i)
			time.Sleep(10 * time.Millisecond)
		}
	}()
	go func() {
		defer wg.Done()
		for i := 0; i < 10; i++ {
			v := buf.Get()
			fmt.Println("got", v)
			time.Sleep(15 * time.Millisecond)
		}
	}()
	wg.Wait()
}
```

Go's `sync.Cond` is rarely the first tool you reach for — channels usually win — but it exists and works just like every other implementation. Note `sync.NewCond(&b.mu)` ties the condvar to a specific mutex. `Wait()` must be called with the lock held; it releases it, sleeps, and re-acquires before returning.

### Rust (`std::sync::Condvar`)

```rust
// bounded_buffer.rs
use std::collections::VecDeque;
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::Duration;

struct BoundedBuffer {
    inner: Mutex<VecDeque<i32>>,
    not_full: Condvar,
    not_empty: Condvar,
    cap: usize,
}

impl BoundedBuffer {
    fn new(cap: usize) -> Self {
        Self {
            inner: Mutex::new(VecDeque::with_capacity(cap)),
            not_full: Condvar::new(),
            not_empty: Condvar::new(),
            cap,
        }
    }

    fn put(&self, v: i32) {
        let mut q = self.inner.lock().unwrap();
        while q.len() == self.cap {
            q = self.not_full.wait(q).unwrap();
        }
        q.push_back(v);
        self.not_empty.notify_one();
    }

    fn get(&self) -> i32 {
        let mut q = self.inner.lock().unwrap();
        while q.is_empty() {
            q = self.not_empty.wait(q).unwrap();
        }
        let v = q.pop_front().unwrap();
        self.not_full.notify_one();
        v
    }
}

fn main() {
    let buf = Arc::new(BoundedBuffer::new(4));
    let p = {
        let buf = Arc::clone(&buf);
        thread::spawn(move || {
            for i in 0..10 {
                buf.put(i);
                println!("put {}", i);
                thread::sleep(Duration::from_millis(10));
            }
        })
    };
    let c = {
        let buf = Arc::clone(&buf);
        thread::spawn(move || {
            for _ in 0..10 {
                let v = buf.get();
                println!("got {}", v);
                thread::sleep(Duration::from_millis(15));
            }
        })
    };
    p.join().unwrap();
    c.join().unwrap();
}
```

Rust's `Condvar::wait` takes ownership of the `MutexGuard` and returns a new one — that is how the compiler enforces the rule "you must hold the lock to wait, and you hold it again when you return." There is no way to call `wait` without a guard.

---

## Pros & Cons

**Pros**

- **Efficient blocking.** Sleeping threads consume no CPU. Unlike busy-waiting, you do not waste cycles polling.
- **Composable with mutexes.** Reuses the mutex you already have to protect shared state. No new locking discipline.
- **Standard, universal.** Available in every threading library with nearly identical semantics.
- **Flexible.** One mutex can be paired with multiple condvars to express different waiting conditions cheaply.
- **Foundation for higher-level primitives.** Semaphores, barriers, channels, and futures are often built on top.

**Cons**

- **Easy to misuse.** Forget the `while` loop and you get the predicate-not-true bug. Signal without the mutex and you risk lost wakeups.
- **No data carried.** Unlike a channel, a signal carries no payload. You must put the data under the mutex separately.
- **Spurious wakeups.** Add boilerplate even in correct code.
- **No memory of past signals.** A signal sent before anyone is waiting is lost; you usually need a flag to bridge the gap.
- **Lower-level than ideal.** Higher-level primitives (channels, futures, blocking queues) are usually clearer and harder to misuse when they fit the problem.

---

## Use Cases

- **Producer-consumer queues** (our running example). Producers wait when full, consumers wait when empty.
- **Resource pools.** Threads wait for a free database connection, file handle, or buffer.
- **Worker thread coordination.** Workers sleep until tasks are added to a task queue.
- **Barriers and rendezvous.** Threads wait until N have arrived, then all proceed.
- **Read-write locks.** Many implementations of `RWLock` use condvars internally to suspend writers while readers are active and vice versa.
- **Implementing futures and promises.** A future blocks on a condvar until its value is set.
- **Shutdown notification.** A `done` flag plus a condvar lets background workers exit cleanly.
- **Event waiting.** "Wait until the server has finished initialising" or "wait until the queue drains".

---

## Coding Patterns

**Pattern 1: predicate-in-a-loop.**

```python
with cv:
    while not predicate():
        cv.wait()
    do_work()
```

This is the only correct pattern for waiting. Internalise it.

**Pattern 2: state-change-then-signal.**

```python
with cv:
    modify_state()
    cv.notify()      # or notify_all()
```

Always modify state and signal under the same lock. Never signal without holding the mutex (it is allowed but error-prone; for juniors, always hold it).

**Pattern 3: one mutex, multiple condvars.**

```c
// One mutex protects the buffer. Two condvars distinguish waiters.
while (full)  pthread_cond_wait(&not_full, &mu);
while (empty) pthread_cond_wait(&not_empty, &mu);
```

Use a separate condvar per waiting condition so you can signal precisely instead of broadcasting.

**Pattern 4: shutdown flag.**

```python
with cv:
    while not (item_available() or shutting_down):
        cv.wait()
    if shutting_down:
        return
    work_on(item)
```

A boolean `shutting_down` makes shutdown a state change like any other. Set it to true and broadcast; all waiters wake, see the flag, and exit.

**Pattern 5: timed wait with deadline.**

```python
deadline = time.monotonic() + timeout
with cv:
    while not predicate():
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return False
        cv.wait(timeout=remaining)
return True
```

Note we recompute `remaining` each iteration; if `wait` returns spuriously, we do not extend the deadline.

**Pattern 6: monitor class.**

```python
class Monitor:
    def __init__(self):
        self._cond = threading.Condition()
        self._state = ...

    def do_something(self):
        with self._cond:
            while not self._can_do_something():
                self._cond.wait()
            self._do_it()
            self._cond.notify_all()
```

Wrap mutex + condvar inside an object. Callers never see the lock directly.

---

## Clean Code

- **Name your condvars after the condition.** `not_empty`, `not_full`, `task_ready`, `space_available`. Never `cond1`, `cv`, `c`.
- **One predicate per condvar where possible.** It makes `signal` (not `broadcast`) safe and clear.
- **Keep the critical section short.** Inside the lock, do only what needs the lock; long work blocks every other thread.
- **Encapsulate.** Make the mutex and condvars private to the class. Expose only methods that internally lock.
- **Comment the invariant.** "`count` is always between 0 and `CAP`, and equals the number of items currently in `items`." Reviewers will thank you.
- **Pair every `wait` with a `while` loop.** No exceptions, ever. If you find yourself writing `if`, slow down.
- **Use RAII / `with` / `defer` to unlock.** Manual `unlock` in C is a forgotten-call away from deadlock.
- **Do not sleep on raw timeouts to "poll" state.** Always use timed `wait`, so you wake immediately on a state change.

---

## Best Practices

1. **Always check the predicate in a `while` loop.** Never `if`. Period.
2. **Always hold the mutex while waiting and signalling.** Some implementations let you signal without the lock, but it makes lost-wakeup bugs much easier to write.
3. **Pair each condvar with the same mutex everywhere.** A condvar must always be used with one specific mutex during its lifetime.
4. **Prefer `signal` when you can prove only one waiter needs to wake.** Otherwise use `broadcast`. When unsure, broadcast.
5. **Use multiple condvars to avoid thundering herds.** `not_full` and `not_empty` instead of a single condvar where everyone retries.
6. **Encapsulate condvars inside data structures.** Do not expose them to clients; expose blocking methods (`take`, `put`).
7. **Use timed waits for shutdown and deadlines.** Plain `wait` cannot be interrupted by mere timing; pair it with a flag or use the timeout API.
8. **Reach for higher-level primitives first.** Blocking queue, channel, `Future`, `Semaphore`. They are condvars done right.
9. **Document the predicate.** Above every `wait`, write a comment saying what condition the thread is waiting for.
10. **Test under load.** Spurious wakeups, race-y interleavings, and lost wakeups often hide until the system is busy.

---

## Edge Cases & Pitfalls

- **Signalling without the lock.** Technically allowed by some APIs, but if you also set the state outside the lock you guarantee lost wakeups. Always set state and signal under the lock for juniors.
- **Different mutexes on the same condvar.** Undefined behaviour in pthreads, error in C++/Rust. The condvar binds to exactly one mutex.
- **Forgetting to re-check after timeout.** A timeout does not mean the predicate is false; the producer may have signalled at almost the same moment. Always re-check.
- **`notify` instead of `notifyAll` in Java with mixed waiters.** Java's `notify` wakes one arbitrary waiter; if your producer's `notify` wakes another producer (who finds the buffer still full and goes back to sleep), the consumer that should have been woken is never told. Use `notifyAll` or separate condvars.
- **Interrupted `wait` in Java/Python.** `InterruptedException` (Java) or `KeyboardInterrupt`-induced wake (Python) can break out of `wait`. Handle the interrupt explicitly.
- **Destroying a condvar with waiters.** Undefined behaviour. Always make sure no one is waiting before destruction (drain, set shutdown flag, join threads).
- **Signal on the wrong condvar.** Producer signals `not_full` when it should signal `not_empty`. Result: consumers never wake. Use clear names to avoid this.
- **Holding the lock too long around signal.** Some textbooks recommend `unlock; signal` for performance (the woken thread won't immediately collide with the lock). It is correct and faster, but slightly easier to misuse. At the junior level, keep signalling under the lock.

---

## Common Mistakes

1. **Using `if` instead of `while`.** Spurious or stolen wakeups will silently break your code.
2. **Setting shared state without the mutex.** "It's just one flag" — no, the wakeup is racy.
3. **Forgetting to call `signal` after a state change.** The waiter sleeps forever.
4. **Calling `wait` without holding the lock.** Some libraries return an error; others crash; pthreads is undefined behaviour.
5. **Confusing condvars with semaphores.** A semaphore counts; a condvar does not. A signal with no waiters is lost.
6. **One condvar for everything.** Producers and consumers waiting on the same condvar with `signal` causes lost work.
7. **Polling with `time.sleep` while holding a flag.** Always use a timed `wait`; you sleep less and respond faster.
8. **Forgetting `notify_all` on shutdown.** If only one waiter is notified but ten threads are waiting, nine threads never see the shutdown flag.
9. **Calling user code while holding the lock.** Long, uninterruptible callbacks under the lock block everyone. Extract data out and call back outside.
10. **Building a "lock-free" condvar.** You can't; condvars need a mutex by design. If you think you don't, you have probably hidden it inside an atomic.

---

## Tricky Points

- **`wait` is not a hint; it is a contract.** "Release the mutex, sleep, re-acquire" is exactly what happens. Knowing this lets you reason about who can run while you sleep.
- **Mesa semantics make the loop mandatory.** Even with no spurious wakeups, another thread could steal your work between `signal` and your re-acquisition. The loop is correct for both.
- **`broadcast` is not "stronger signal", it is "different signal".** Use it when you mean "wake every relevant waiter". Do not reach for it just because `signal` "feels weak".
- **Condvars do not own state.** They are not a flag, a counter, or a queue. They are a sleep/wake mechanism. The state is yours to track under the mutex.
- **A signal with no waiters is lost.** Therefore the state under the mutex must be enough for a future waiter to decide whether to sleep.
- **Mixing `Condition` and `Lock` types in Java.** A `Condition` belongs to a `ReentrantLock`. You cannot `await` a `Condition` while holding a different lock; you'll get `IllegalMonitorStateException`.
- **Rust's `wait` returns the guard.** This is not cosmetic — the compiler uses it to enforce "you held the lock; you hold it again". You cannot accidentally drop the guard.
- **Go's `sync.Cond.Wait` is not selectable.** Unlike channel receive, you cannot `select` on `Cond.Wait`. That is one reason Go programmers prefer channels.

---

## Test Yourself

1. Why must `wait` be called with the mutex already held?
2. What is a spurious wakeup, and what code structure handles it correctly?
3. Why use a `while` loop rather than an `if` around `wait`?
4. What is the difference between `signal` (or `notify_one`) and `broadcast` (or `notify_all`)?
5. Why is "set state outside the lock, then signal" a recipe for lost wakeups?
6. In the bounded buffer, why do we use two condvars (`not_full` and `not_empty`) instead of one?
7. What happens if you destroy a condition variable while another thread is waiting on it?
8. What is the Mesa vs Hoare distinction, and which do mainstream languages use?
9. Why does Java's `notify` (vs `notifyAll`) cause subtle bugs when producers and consumers share a lock?
10. How would you implement a `wait_until(deadline)` correctly on top of a plain `wait`?

Try implementing the bounded buffer in your favourite language from scratch, without looking at the examples. Then run two producers and two consumers and check the output is well-formed.

---

## Tricky Questions

1. **Can a thread that has just been signalled assume the predicate is true?** No. Under Mesa semantics, another thread might run first and falsify it. The `while` loop is what makes the code correct.
2. **Why not just busy-wait with a flag?** Busy-waiting burns CPU and adds latency under contention; it also has memory-model pitfalls. Condvars are O(0) CPU while waiting.
3. **What if `signal` is called when no one is waiting?** The signal is lost. This is why the predicate (stored under the mutex) is essential: a future waiter sees the changed state and does not sleep.
4. **Why is `pthread_cond_wait` a cancellation point in pthreads?** Because it can block indefinitely; making it cancellable lets `pthread_cancel` actually stop the thread.
5. **Is signalling under or outside the lock better?** Both are correct. Signalling under the lock is easier to reason about (the same critical section publishes state and wakes waiters). Signalling outside the lock can avoid an immediate context-switch contention but is slightly easier to get wrong.
6. **Can you implement a semaphore from a condvar?** Yes: a counter under a mutex, plus a condvar; `acquire` waits while counter is 0; `release` increments and signals. Many libraries do this internally.
7. **Why doesn't Go have `wait` on a channel?** Because receiving from a channel already blocks. Channels merge "data passing" and "wait until ready" into one primitive.
8. **What is wait-morphing?** A glibc/futex optimisation: when you signal a condvar while holding the mutex, the implementation moves the waiter from the condvar's wait queue directly to the mutex's wait queue, avoiding a wake-then-block cycle. Senior topic; mention it if asked.

---

## Cheat Sheet

```text
Pattern (every language, almost identical):

    acquire(mutex)
    while (NOT predicate):
        cond.wait(mutex)          # releases mutex, sleeps, re-acquires
    do_work_with_predicate_true()
    release(mutex)

To change state:

    acquire(mutex)
    modify_shared_state()
    cond.signal()                 # or broadcast() if many waiters might apply
    release(mutex)

Rules:
  1. ALWAYS hold the mutex before calling wait or signal.
  2. ALWAYS use `while (NOT predicate)` — never `if`.
  3. ONE condvar : ONE mutex (do not mix).
  4. Multiple condvars on the SAME mutex are fine and often desirable.
  5. Use `broadcast` when more than one waiter can make progress OR
     when waiters check different predicates on the same condvar.
  6. Use `signal` when only one waiter can progress per state change.
  7. A signal with no waiters is LOST. The state under the mutex must
     be enough for a future waiter to decide whether to sleep.
  8. Timed waits: recompute the remaining deadline each loop iteration.

Common APIs:

    pthread:  pthread_cond_wait, pthread_cond_signal, pthread_cond_broadcast
    C++   :   cv.wait(lock, pred), cv.notify_one(), cv.notify_all()
    Java  :   obj.wait(), obj.notify(), obj.notifyAll()
              cond.await(), cond.signal(), cond.signalAll()
    Python:   cond.wait(timeout), cond.notify(n), cond.notify_all()
    Go    :   cond.Wait(), cond.Signal(), cond.Broadcast()
    Rust  :   cv.wait(guard), cv.notify_one(), cv.notify_all()
```

---

## Summary

Condition variables are the primitive that lets a thread sleep until a specific condition becomes true. They are simple in API (`wait`, `signal`, `broadcast`) but require a small set of rules to use correctly: always pair the condvar with a mutex, always hold the mutex while waiting and signalling, always check the predicate in a `while` loop (because spurious and stolen wakeups happen), and remember that a signal with no waiters is lost.

Under Mesa semantics — the discipline every mainstream language uses — a signal does not guarantee that the woken thread sees the predicate as true. The runtime only marks the waiter as runnable; another thread may run first and change the state. That is why the predicate-in-a-loop pattern is non-negotiable. Once you internalise it, condvar code becomes almost mechanical: lock, while not predicate wait, do work, signal, unlock.

The classic application is the monitor pattern: a class with private state, a private mutex, and one or more private condvars, exposing blocking methods such as `put` and `take`. The bounded producer-consumer buffer presented above is the canonical example. Implementing it cleanly in C, Java, Python, Go, and Rust gives you a portable mental model for every threading library you will meet.

Higher-level primitives — channels, blocking queues, futures, semaphores — are usually built on top of condvars and are usually a better choice when they fit. But understanding condvars is what lets you read the implementation of those higher-level primitives, debug them when they misbehave, and roll your own when no off-the-shelf option fits. Master the predicate-in-a-loop pattern, learn when to signal vs broadcast, and condvars become a reliable, boring tool — which is exactly what you want from a synchronization primitive.

---

## What You Can Build

- A **bounded blocking queue** for producer-consumer pipelines.
- A **thread pool** where workers wait on a `task_available` condvar.
- A **connection pool** with `acquire`/`release` and `wait`-until-free.
- A **rate limiter** that blocks callers when tokens are exhausted.
- A **barrier** that releases all threads when N have arrived.
- A **graceful shutdown** mechanism with a `done` flag and broadcast.
- A **timed event** ("wait until cache is warmed up, or 5s, whichever first").
- A **simple `Future`/`Promise`** whose `get()` blocks until `set()` is called.

---

## Further Reading

- *Operating System Concepts* (Silberschatz, Galvin, Gagne) — monitors and condvars chapter.
- *The Art of Multiprocessor Programming* (Herlihy, Shavit) — chapter on monitors and synchronization.
- *Programming with POSIX Threads* (Butenhof) — the classic, in-depth treatment of pthread condvars.
- *Java Concurrency in Practice* (Goetz et al.) — chapters on intrinsic monitors and `Condition`.
- C++ `<condition_variable>` reference on cppreference.
- Python `threading.Condition` documentation.
- Go `sync.Cond` documentation.
- Rust `std::sync::Condvar` documentation.
- Mesa vs Hoare monitors, original papers by Lampson & Redell (Mesa, 1980) and Hoare (1974).

---

## Related Topics

- [Middle level](middle.md) — multiple producers/consumers, fairness, wait-morphing, signal-vs-broadcast trade-offs, `Condition` in `java.util.concurrent.locks`.
- [Senior level](senior.md) — futex-based implementation, kernel-level wakeup costs, condvar in glibc.
- [Professional level](professional.md) — designing condvar-based primitives, debugging lost wakeups in production, tracing tools.
- [Interview](interview.md) — typical questions and traps about condvars.
- [Tasks](tasks.md) — hands-on exercises (blocking queue, semaphore from condvar, barrier, future).
- [Mutex — Junior](../01-mutex/junior.md) — the partner primitive without which condvars cannot exist.
- [Semaphore — Junior](../02-semaphore/junior.md) — a counted alternative; can be built from a condvar.
- [Channels — Junior](../05-channels/junior.md) — higher-level synchronization that often replaces condvars in Go and Rust.

---

## Diagrams & Visual Aids

**Wait/signal timeline (Mesa semantics):**

```
Consumer:        Mutex:           Producer:
---------        ------           ---------
acquire(mu)  -->  held(C)
check pred (false)
cond.wait(mu) -> released
   |
   | (sleeping on cv)
   |
                  free            acquire(mu)  -->  held(P)
                                  push item
                                  cond.signal()         (consumer marked runnable)
                                  release(mu)  -->  free
   |
   (woken, attempts re-acquire)
acquire(mu)  -->  held(C)
check pred (true)
do_work()
release(mu)  -->  free
```

**Bounded buffer with two condvars:**

```
                +-----------------------------+
                |   shared queue (mu)         |
                |   items[CAP], head, tail    |
                +-----------------------------+
                          ^         ^
                          |         |
            wait(not_full)|         |wait(not_empty)
                          |         |
                  +-------+         +-------+
                  | producer1 ...   | consumer1 ...
                  | producer2 ...   | consumer2 ...
                  +-----------------+

   put():  while full   -> wait(not_full)    ; push ; signal(not_empty)
   get():  while empty  -> wait(not_empty)   ; pop  ; signal(not_full)
```

**Spurious wakeup loop:**

```
   while (NOT predicate):
       cv.wait(mu)
   // ^ if a spurious wakeup happens, we just loop back and sleep again.
   // ^ if a real signal happens but another thread stole the work, same thing.
   // ^ if a real signal happens and we get the work, we exit the loop.
```

**Signal vs broadcast:**

```
   signal()   : wakes 1 waiter (or none if queue empty)
                 [ A B C D ]  --signal-->  A is runnable, [ B C D ] still asleep

   broadcast(): wakes ALL waiters
                 [ A B C D ]  --broadcast-->  A B C D all runnable; they race for mu
```
