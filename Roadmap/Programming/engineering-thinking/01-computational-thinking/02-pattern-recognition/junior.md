> **What?** Pattern recognition is noticing that a new problem you're facing is *the same shape* as a problem you (or someone else) has already solved — so you can reuse the known solution instead of inventing one from scratch. It's the second pillar of computational thinking, sitting right after [decomposition](../01-decomposition/).
>
> **How?** When you hit a problem, before you start typing, ask: *"What does this remind me of? Have I seen this shape before?"* If a new task looks like "find the longest substring without repeats," and you've seen sliding-window problems, you say *"this is a sliding-window problem"* and pull the known template instead of writing a triple-nested loop.

---

## 1. What a "pattern" actually is

A pattern is a **recurring structure** that shows up across many different surface problems. The surface details change — names, data types, business domain — but the underlying *shape* repeats.

A concrete example. These three tasks look unrelated:

- Find the longest substring of a string with no repeated character.
- Find the maximum sum of any 5 consecutive numbers in an array.
- Count how many time-windows of 60 seconds contain more than 100 requests.

Surface: strings, numbers, log timestamps. Different domains entirely. But they're **the same problem**: you slide a window over a sequence and maintain something about what's inside the window. Once you see that, you don't re-derive the algorithm three times — you recognize *"sliding window"* and apply one template.

```
Surface problem  →  "what shape is this?"  →  known pattern  →  known solution
"longest substring" →  slide a window      →  sliding window →  two indices + a set
```

Recognizing the shape is the skill. The solution is already known — it's written down in a hundred places. Your job is the *mapping*.

## 2. Why this matters more than memorizing solutions

You cannot memorize a solution for every problem you'll ever face — there are infinitely many surface problems. But there is a **small, finite set of underlying patterns**. Maybe a few dozen algorithmic patterns cover the overwhelming majority of coding-interview and day-to-day data-shuffling problems.

So the leverage is enormous: learn ~30 patterns, and you can attack thousands of problems. Memorize 1000 solutions, and you can attack 1000 problems. Patterns are **compressed experience** — one pattern stands in for hundreds of specific cases.

This is exactly why senior engineers seem fast. They're usually not smarter on the spot; they've just seen the shape before. Where you see a brand-new, scary problem, they see *"oh, this is just a graph traversal with a visited-set."*

## 3. The most common algorithmic patterns (your starter library)

Build these into your reflexes first. The right-hand column is the *signal* — the clue in the problem statement that should trigger recognition.

| Pattern | Signal in the problem | Known solution sketch |
|---|---|---|
| **Two pointers** | sorted array, "find a pair", "in-place reverse/dedup" | one pointer from each end (or fast/slow) move toward each other |
| **Sliding window** | "contiguous subarray/substring", "longest/shortest window where…" | expand right, shrink left, track window state |
| **Hash map / set lookup** | "have I seen this before?", "count occurrences", "find duplicates" | store seen items for O(1) lookup |
| **BFS** | "shortest path in unweighted graph", "level by level", "nearest" | queue + visited set |
| **DFS** | "explore all paths", "connected components", "does a path exist" | recursion or stack + visited set |
| **Binary search** | sorted input, "find threshold", "minimize the maximum" | halve the search space each step |
| **Sorting first** | "find pairs/intervals", "group similar items" | sort, then a linear pass becomes easy |

You don't need to know *how* to implement all of these perfectly yet. You need to start **naming** them, so when you meet one in the wild, a bell rings.

## 4. A worked example: recognizing the shape

You're asked: *"Given a list of users and the friends each one has, find everyone reachable from user A."*

A junior who can't pattern-match starts inventing loops, gets tangled, and reinvents a buggy version of something well-known. A junior who *can* pattern-match thinks:

1. "Users connected to other users" → that's **nodes and edges** → it's a **graph**.
2. "Everyone reachable from a starting point" → that's **graph traversal**.
3. "Reachability, order doesn't matter" → **BFS or DFS** both work, pick one.

Now the solution writes itself, because the BFS template is standard:

```python
def reachable(start, friends):
    seen = {start}
    queue = [start]
    while queue:
        person = queue.pop(0)
        for friend in friends[person]:
            if friend not in seen:      # the "visited set" half of the pattern
                seen.add(friend)
                queue.append(friend)
    return seen
```

The hard part was never the code. It was the sentence: *"this is a graph traversal."* Everything after that is template.

## 5. How to start building your pattern library

Patterns don't arrive by magic. You install them deliberately.

- **Do katas, but reflect.** After solving a problem, don't just move on. Ask: *"What category was that? What was the signal that should have told me?"* Write the category next to it. The reflection is where the pattern gets filed in your memory — not the solving.
- **Read other people's solutions.** When you see an elegant solution, name its pattern. "Ah, they used two pointers here." You're stocking your shelf.
- **Group problems by pattern, not by topic.** Don't think "this is an Amazon problem." Think "this is a sliding-window problem." That's the label that transfers.

This is closely tied to how learning works — see [learning how to learn](../../10-metacognition-and-learning/01-learning-how-to-learn/). Patterns are *chunks*: bundles of knowledge your brain treats as a single unit, so they take up less working memory and free you to think about the hard parts.

## 6. The first trap to know about: forcing the pattern

Once you learn a pattern, there's a strong pull to see it *everywhere* — even where it doesn't fit. You learn recursion and suddenly every problem "should" be recursive. You learn a fancy data structure and want to use it on a five-element list.

The classic name for this is **the law of the instrument**, often quoted as: *"If all you have is a hammer, everything looks like a nail"* (Abraham Maslow, 1966). When you only know one pattern, every problem looks like that pattern.

The cure at your level is simple awareness plus a habit: after you *think* you've matched a pattern, do one sanity check — **does the problem actually have the signal?** A sliding-window pattern needs a *contiguous* window. If the problem allows skipping elements, it's not a sliding window, no matter how much you want it to be. Check the signal, not your hope.

## 7. Pattern recognition in debugging

Patterns aren't only for writing code — they're huge in fixing it. Bugs have **signatures**: a recurring symptom that maps to a class of cause.

| Symptom you see | Pattern it usually signals |
|---|---|
| `NullPointerException` / `undefined is not a function` | something you assumed existed didn't — a missing null check |
| Works alone, fails under load | a concurrency / shared-state problem |
| `index out of range` at the last element | an off-by-one in a loop boundary |
| Memory keeps climbing, then crash | a leak — something held that should've been freed |
| Fast in dev, slow in prod | the dataset is bigger; an O(n²) you didn't notice |

When you've seen a symptom enough times, you stop debugging from scratch. You see the stack trace and think *"oh, this signature — it's almost always X."* That instinct is pure pattern recognition, and it's why experienced engineers fix some bugs in seconds that would take you an hour.

---

## Key takeaways

- A **pattern** is a recurring *shape* across surface-different problems; recognizing it lets you reuse a known solution instead of inventing one.
- A small set of patterns covers a huge range of problems — patterns are **compressed experience**, far more leverage than memorizing solutions.
- Learn to **name** the common algorithmic patterns (two pointers, sliding window, BFS/DFS, binary search) and the *signal* that triggers each.
- The mapping — *"this is a graph traversal"* — is the hard, valuable part; the code is usually template.
- Beware the **law of the instrument**: don't force a familiar pattern onto a problem that lacks its signal. Check the signal, not your hope.
- Build your library deliberately through **reflection** on katas and reading others' code; the same skill powers fast **debugging** via symptom signatures.

**Next:** [abstraction and generalization](../03-abstraction-and-generalization/) — once you recognize a pattern, you can abstract it into something reusable. See also [decomposition](../01-decomposition/) and the [section overview](../).
