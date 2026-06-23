# Python Loops — Find the Bug

> Find and fix the bug in each code snippet. Each exercise has a difficulty level and a hidden solution.

---

## Easy (3 Bugs)

### Bug 1: Infinite Loop

```python
def countdown(n):
    """Print numbers from n down to 1."""
    while n > 0:
        print(n)

countdown(5)
```

<details>
<summary>Hint</summary>
The loop condition never becomes <code>False</code>. What's missing?
</details>

<details>
<summary>Solution</summary>

**Bug:** `n` is never decremented, so `n > 0` is always `True`.

```python
def countdown(n):
    """Print numbers from n down to 1."""
    while n > 0:
        print(n)
        n -= 1  # FIX: decrement n

countdown(5)
```
</details>

---

### Bug 2: Off-By-One in Range

```python
def print_1_to_10():
    """Print numbers from 1 to 10 inclusive."""
    for i in range(10):
        print(i)

print_1_to_10()
```

<details>
<summary>Hint</summary>
<code>range(10)</code> starts at 0 and stops before 10.
</details>

<details>
<summary>Solution</summary>

**Bug:** `range(10)` produces `0, 1, 2, ..., 9` — starts at 0 and excludes 10.

```python
def print_1_to_10():
    """Print numbers from 1 to 10 inclusive."""
    for i in range(1, 11):  # FIX: start=1, stop=11
        print(i)

print_1_to_10()
```
</details>

---

### Bug 3: Wrong Variable in Nested Loop

```python
def find_pair_sum(numbers, target):
    """Find two numbers that add up to target."""
    for i in range(len(numbers)):
        for j in range(len(numbers)):
            if i != j and numbers[i] + numbers[i] == target:
                return (numbers[i], numbers[j])
    return None

print(find_pair_sum([1, 3, 5, 7], 8))  # Expected: (1, 7) or (3, 5)
```

<details>
<summary>Hint</summary>
Look carefully at the comparison: <code>numbers[i] + numbers[?]</code>.
</details>

<details>
<summary>Solution</summary>

**Bug:** `numbers[i] + numbers[i]` should be `numbers[i] + numbers[j]` — the second index uses `i` instead of `j`.

```python
def find_pair_sum(numbers, target):
    """Find two numbers that add up to target."""
    for i in range(len(numbers)):
        for j in range(len(numbers)):
            if i != j and numbers[i] + numbers[j] == target:  # FIX: numbers[j]
                return (numbers[i], numbers[j])
    return None

print(find_pair_sum([1, 3, 5, 7], 8))  # (1, 7)
```
</details>

---

## Medium (4 Bugs)

### Bug 4: Modifying List During Iteration

```python
def remove_negatives(numbers):
    """Remove all negative numbers from the list."""
    for num in numbers:
        if num < 0:
            numbers.remove(num)
    return numbers

result = remove_negatives([1, -2, -3, 4, -5, -6, 7])
print(result)  # Expected: [1, 4, 7]
```

<details>
<summary>Hint</summary>
Modifying a list while iterating over it causes the iterator to skip elements.
</details>

<details>
<summary>Solution</summary>

**Bug:** Removing elements from a list while iterating causes elements to be skipped. When `-2` is removed, the iterator jumps over `-3`.

```python
def remove_negatives(numbers):
    """Remove all negative numbers from the list."""
    # FIX: Use list comprehension to create a new list
    return [num for num in numbers if num >= 0]

result = remove_negatives([1, -2, -3, 4, -5, -6, 7])
print(result)  # [1, 4, 7]
```

Alternative fix — iterate over a copy:
```python
def remove_negatives(numbers):
    for num in numbers[:]:  # iterate over a copy
        if num < 0:
            numbers.remove(num)
    return numbers
```
</details>

---

### Bug 5: Late Binding Closure

```python
def create_multipliers():
    """Create a list of functions that multiply by 0, 1, 2, 3, 4."""
    multipliers = []
    for i in range(5):
        multipliers.append(lambda x: x * i)
    return multipliers

mults = create_multipliers()
print(mults[0](10))  # Expected: 0
print(mults[1](10))  # Expected: 10
print(mults[2](10))  # Expected: 20
# Actual: all return 40!
```

<details>
<summary>Hint</summary>
Python closures capture <strong>variables</strong>, not <strong>values</strong>. All lambdas share the same <code>i</code>.
</details>

<details>
<summary>Solution</summary>

**Bug:** Late binding — all lambdas reference the same variable `i`, which is 4 after the loop ends. So `x * i` is always `x * 4`.

```python
def create_multipliers():
    """Create a list of functions that multiply by 0, 1, 2, 3, 4."""
    multipliers = []
    for i in range(5):
        multipliers.append(lambda x, i=i: x * i)  # FIX: capture i as default arg
    return multipliers

mults = create_multipliers()
print(mults[0](10))  # 0
print(mults[1](10))  # 10
print(mults[2](10))  # 20
```
</details>

---

### Bug 6: Generator Exhaustion

```python
def get_even_numbers(limit):
    """Generate even numbers up to limit."""
    return (x for x in range(limit) if x % 2 == 0)

evens = get_even_numbers(20)

print("Sum:", sum(evens))        # Works: 90
print("Count:", len(list(evens)))  # Expected: 10
print("Max:", max(evens))        # Expected: 18
```

<details>
<summary>Hint</summary>
A generator can only be iterated <strong>once</strong>.
</details>

<details>
<summary>Solution</summary>

**Bug:** The generator `evens` is exhausted after `sum(evens)`. `list(evens)` and `max(evens)` operate on an empty iterator.

```python
def get_even_numbers(limit):
    """Generate even numbers up to limit."""
    return (x for x in range(limit) if x % 2 == 0)

# FIX Option 1: Materialize into a list first
evens = list(get_even_numbers(20))
print("Sum:", sum(evens))           # 90
print("Count:", len(evens))         # 10
print("Max:", max(evens))           # 18

# FIX Option 2: Recreate the generator each time
print("Sum:", sum(get_even_numbers(20)))
print("Count:", sum(1 for _ in get_even_numbers(20)))
print("Max:", max(get_even_numbers(20)))
```
</details>

---

### Bug 7: Dictionary Modification During Iteration

```python
def remove_low_scores(scores):
    """Remove students with scores below 50."""
    for name, score in scores.items():
        if score < 50:
            del scores[name]
    return scores

students = {"Alice": 85, "Bob": 42, "Charlie": 38, "Diana": 91}
print(remove_low_scores(students))
# RuntimeError: dictionary changed size during iteration
```

<details>
<summary>Hint</summary>
You cannot delete keys from a dict while iterating over it.
</details>

<details>
<summary>Solution</summary>

**Bug:** Deleting keys from a dict during iteration causes `RuntimeError`.

```python
def remove_low_scores(scores):
    """Remove students with scores below 50."""
    # FIX: Use dict comprehension to create a new dict
    return {name: score for name, score in scores.items() if score >= 50}

students = {"Alice": 85, "Bob": 42, "Charlie": 38, "Diana": 91}
print(remove_low_scores(students))
# {'Alice': 85, 'Diana': 91}
```

Alternative fix — collect keys first:
```python
def remove_low_scores(scores):
    to_remove = [name for name, score in scores.items() if score < 50]
    for name in to_remove:
        del scores[name]
    return scores
```
</details>

---

## Hard (3 Bugs)

### Bug 8: Subtle `else` Clause Bug

```python
def find_prime(numbers):
    """Return the first prime number in the list, or None."""
    for num in numbers:
        if num < 2:
            continue
        for divisor in range(2, int(num ** 0.5) + 1):
            if num % divisor == 0:
                break
        else:
            return num
    return None

# Test
print(find_prime([4, 6, 8, 9, 11, 13]))  # Expected: 11
print(find_prime([1, 4, 6]))              # Expected: None
print(find_prime([2, 3, 5]))              # Expected: 2  -- BUT...
print(find_prime([1]))                     # Expected: None
```

<details>
<summary>Hint</summary>
What happens when <code>num = 2</code>? The inner <code>range(2, 2)</code> is empty. Does the <code>else</code> still run?
</details>

<details>
<summary>Solution</summary>

**Trick question:** This code is actually **correct**! When `num = 2`, `range(2, int(2**0.5) + 1)` is `range(2, 2)` which is empty. An empty `for` loop completes "normally" (no `break`), so the `else` clause runs, correctly identifying 2 as prime.

The real bug that many developers expect here is actually a feature — the `else` on an empty loop does execute. If this confuses your team, add a comment:

```python
def find_prime(numbers):
    """Return the first prime number in the list, or None."""
    for num in numbers:
        if num < 2:
            continue
        for divisor in range(2, int(num ** 0.5) + 1):
            if num % divisor == 0:
                break  # composite number
        else:
            # Runs if no divisor found (loop completed without break)
            # Also runs for empty range (e.g., num=2, num=3)
            return num
    return None
```

**The real educational point:** Many developers don't know that `else` runs even on an empty loop, which can be a source of subtle bugs when the expected behavior is different.
</details>

---

### Bug 9: Accumulator Reset in Wrong Scope

```python
def group_consecutive(nums):
    """Group consecutive equal numbers.
    [1, 1, 2, 2, 2, 3, 1, 1] -> [[1, 1], [2, 2, 2], [3], [1, 1]]
    """
    if not nums:
        return []

    groups = []
    current_group = [nums[0]]

    for i in range(1, len(nums)):
        if nums[i] == nums[i - 1]:
            current_group.append(nums[i])
        else:
            groups.append(current_group)
            current_group = [nums[i]]

    return groups

print(group_consecutive([1, 1, 2, 2, 2, 3, 1, 1]))
# Expected: [[1, 1], [2, 2, 2], [3], [1, 1]]
# Actual:   [[1, 1], [2, 2, 2], [3]]  — last group is missing!
```

<details>
<summary>Hint</summary>
What happens to <code>current_group</code> after the loop ends?
</details>

<details>
<summary>Solution</summary>

**Bug:** The last `current_group` is never appended to `groups`. After the loop ends, the final group is still in `current_group` but hasn't been added.

```python
def group_consecutive(nums):
    """Group consecutive equal numbers."""
    if not nums:
        return []

    groups = []
    current_group = [nums[0]]

    for i in range(1, len(nums)):
        if nums[i] == nums[i - 1]:
            current_group.append(nums[i])
        else:
            groups.append(current_group)
            current_group = [nums[i]]

    groups.append(current_group)  # FIX: append the last group
    return groups

print(group_consecutive([1, 1, 2, 2, 2, 3, 1, 1]))
# [[1, 1], [2, 2, 2], [3], [1, 1]]
```

This is a classic "fence post error" — the loop handles transitions between groups, but the last group has no transition after it.
</details>

---

### Bug 10: Mutable Default with Loop Accumulation

```python
def collect_items(new_item, collection=[]):
    """Add an item to a collection and return it."""
    collection.append(new_item)
    return collection

# Used in a loop
results = []
for name in ["Alice", "Bob", "Charlie"]:
    result = collect_items(name)
    results.append(result)

print(results)
# Expected: [["Alice"], ["Bob"], ["Charlie"]]
# Actual:   [["Alice", "Bob", "Charlie"],
#            ["Alice", "Bob", "Charlie"],
#            ["Alice", "Bob", "Charlie"]]
```

<details>
<summary>Hint</summary>
Mutable default arguments are shared across all calls. Also, all three entries in <code>results</code> point to the <strong>same</strong> list object.
</details>

<details>
<summary>Solution</summary>

**Bug:** Two issues:
1. The mutable default `collection=[]` is created once and shared across all calls
2. All items in `results` reference the **same** list object

```python
def collect_items(new_item, collection=None):
    """Add an item to a collection and return it."""
    if collection is None:
        collection = []  # FIX: create a new list each time
    collection.append(new_item)
    return collection

results = []
for name in ["Alice", "Bob", "Charlie"]:
    result = collect_items(name)
    results.append(result)

print(results)
# [["Alice"], ["Bob"], ["Charlie"]]
```
</details>

---

### Bug 11: Silent Integer Overflow in Sum Loop

```python
def safe_average(numbers):
    """Calculate the average, handling empty lists."""
    total = 0
    count = 0
    for num in numbers:
        total += num
        count += 1
    return total / count

print(safe_average([10, 20, 30]))  # Works: 20.0
print(safe_average([]))             # ZeroDivisionError!
```

<details>
<summary>Hint</summary>
What happens when <code>numbers</code> is empty? <code>count</code> stays 0.
</details>

<details>
<summary>Solution</summary>

**Bug:** When the list is empty, `count` is 0, causing `ZeroDivisionError`.

```python
def safe_average(numbers):
    """Calculate the average, handling empty lists."""
    total = 0
    count = 0
    for num in numbers:
        total += num
        count += 1

    if count == 0:  # FIX: handle empty input
        return 0.0  # or raise ValueError("Cannot average empty list")

    return total / count

print(safe_average([10, 20, 30]))  # 20.0
print(safe_average([]))             # 0.0
```

Or more Pythonically:
```python
from statistics import mean

def safe_average(numbers):
    if not numbers:
        return 0.0
    return mean(numbers)
```
</details>

---

### Bug 12: Enumerate Start Offset Ignored

```python
def number_lines(lines):
    """Number lines starting from 1."""
    numbered = {}
    for i, line in enumerate(lines):
        numbered[i] = line
    return numbered

text = ["Hello", "World", "Python"]
result = number_lines(text)
print(result)
# Expected: {1: "Hello", 2: "World", 3: "Python"}
# Actual:   {0: "Hello", 1: "World", 2: "Python"}
```

<details>
<summary>Hint</summary>
<code>enumerate()</code> starts at 0 by default. Check the <code>start</code> parameter.
</details>

<details>
<summary>Solution</summary>

**Bug:** `enumerate(lines)` starts at 0 by default.

```python
def number_lines(lines):
    """Number lines starting from 1."""
    numbered = {}
    for i, line in enumerate(lines, start=1):  # FIX: start=1
        numbered[i] = line
    return numbered

text = ["Hello", "World", "Python"]
result = number_lines(text)
print(result)  # {1: 'Hello', 2: 'World', 3: 'Python'}
```
</details>

---

## Score Card

| Difficulty | Bug # | Found? | Fixed? |
|:----------:|:-----:|:------:|:------:|
| Easy | Bug 1: Infinite Loop | [ ] | [ ] |
| Easy | Bug 2: Off-By-One | [ ] | [ ] |
| Easy | Bug 3: Wrong Variable | [ ] | [ ] |
| Medium | Bug 4: List Modification | [ ] | [ ] |
| Medium | Bug 5: Late Binding | [ ] | [ ] |
| Medium | Bug 6: Generator Exhaustion | [ ] | [ ] |
| Medium | Bug 7: Dict Modification | [ ] | [ ] |
| Hard | Bug 8: `else` Clause Trick | [ ] | [ ] |
| Hard | Bug 9: Missing Last Group | [ ] | [ ] |
| Hard | Bug 10: Mutable Default | [ ] | [ ] |
| Hard | Bug 11: Division by Zero | [ ] | [ ] |
| Hard | Bug 12: Enumerate Start | [ ] | [ ] |

**Scoring:**
- **10-12 found:** Expert — you catch subtle loop bugs instinctively
- **7-9 found:** Proficient — you know the common pitfalls well
- **4-6 found:** Intermediate — review the iterator protocol and mutation rules
- **0-3 found:** Beginner — focus on loop fundamentals and Python gotchas
