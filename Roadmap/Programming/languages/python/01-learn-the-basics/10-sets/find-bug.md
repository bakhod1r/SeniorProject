# Sets — Find the Bug

> Find and fix the bug in each code snippet. Each exercise has a difficulty level and a hint.

---

## Score Card

| # | Difficulty | Bug Type | Found? | Fixed? |
|---|:----------:|----------|:------:|:------:|
| 1 | Easy | Wrong constructor | [ ] | [ ] |
| 2 | Easy | Wrong method | [ ] | [ ] |
| 3 | Easy | Unhashable element | [ ] | [ ] |
| 4 | Medium | Mutable default | [ ] | [ ] |
| 5 | Medium | Iteration mutation | [ ] | [ ] |
| 6 | Medium | Boolean/int collision | [ ] | [ ] |
| 7 | Medium | Shallow copy | [ ] | [ ] |
| 8 | Hard | Hash/eq contract | [ ] | [ ] |
| 9 | Hard | Thread safety | [ ] | [ ] |
| 10 | Hard | Mutating after insert | [ ] | [ ] |
| 11 | Hard | Set ordering assumption | [ ] | [ ] |

**Total: ___ / 11**

---

## Easy Bugs

### Bug 1: Empty Set Creation

```python
def get_unique_items(items: list) -> set:
    """Return unique items from a list."""
    unique = {}  # Create an empty set
    for item in items:
        unique.add(item)
    return unique

result = get_unique_items([1, 2, 2, 3])
print(result)
```

**Hint:** What type does `{}` create?

<details>
<summary>Bug & Fix</summary>

**Bug:** `{}` creates an empty **dict**, not a set. Calling `.add()` on a dict raises `AttributeError`.

**Fix:**
```python
def get_unique_items(items: list) -> set:
    unique = set()  # Use set(), not {}
    for item in items:
        unique.add(item)
    return unique
```

</details>

---

### Bug 2: Wrong Removal Method

```python
def safe_remove(s: set, element) -> set:
    """Remove an element from a set safely (no error if missing)."""
    s.remove(element)  # Safe removal
    return s

tags = {"python", "coding", "tutorial"}
safe_remove(tags, "java")
print(tags)
```

**Hint:** Which removal method does NOT raise an error when the element is missing?

<details>
<summary>Bug & Fix</summary>

**Bug:** `remove()` raises `KeyError` if the element is not in the set. The function claims to be "safe" but is not.

**Fix:**
```python
def safe_remove(s: set, element) -> set:
    s.discard(element)  # discard() does not raise KeyError
    return s
```

</details>

---

### Bug 3: Unhashable Set Element

```python
def group_coordinates(coords: list[list[int]]) -> set:
    """Store unique coordinates in a set."""
    unique_coords = set()
    for coord in coords:
        unique_coords.add(coord)  # Add coordinate to set
    return unique_coords

points = [[1, 2], [3, 4], [1, 2]]
result = group_coordinates(points)
print(result)
```

**Hint:** What types can be stored in a set?

<details>
<summary>Bug & Fix</summary>

**Bug:** Lists are unhashable and cannot be added to a set. This raises `TypeError: unhashable type: 'list'`.

**Fix:**
```python
def group_coordinates(coords: list[list[int]]) -> set[tuple[int, ...]]:
    unique_coords: set[tuple[int, ...]] = set()
    for coord in coords:
        unique_coords.add(tuple(coord))  # Convert list to tuple
    return unique_coords
```

</details>

---

## Medium Bugs

### Bug 4: Mutable Default Set Argument

```python
def add_tag(item: str, tags: set = set()) -> set:
    """Add a tag to an item's tag set."""
    tags.add(item)
    return tags

result1 = add_tag("python")
result2 = add_tag("java")
print(f"Result 1: {result1}")
print(f"Result 2: {result2}")
# Expected: Result 1: {'python'}, Result 2: {'java'}
```

**Hint:** How do mutable default arguments work in Python?

<details>
<summary>Bug & Fix</summary>

**Bug:** The default `set()` is created once and shared across all calls. After two calls, both `result1` and `result2` reference the same set `{'python', 'java'}`.

**Fix:**
```python
def add_tag(item: str, tags: set | None = None) -> set:
    if tags is None:
        tags = set()
    tags.add(item)
    return tags
```

</details>

---

### Bug 5: Modifying Set During Iteration

```python
def remove_short_words(words: set[str], min_length: int = 3) -> set[str]:
    """Remove words shorter than min_length from the set."""
    for word in words:
        if len(word) < min_length:
            words.remove(word)
    return words

result = remove_short_words({"hi", "hello", "go", "python", "no"})
print(result)
```

**Hint:** What happens when you modify a set while iterating over it?

<details>
<summary>Bug & Fix</summary>

**Bug:** Modifying a set during iteration raises `RuntimeError: Set changed size during iteration`.

**Fix:**
```python
def remove_short_words(words: set[str], min_length: int = 3) -> set[str]:
    # Option 1: Create a new set with comprehension
    return {word for word in words if len(word) >= min_length}

    # Option 2: Iterate over a copy
    # for word in words.copy():
    #     if len(word) < min_length:
    #         words.remove(word)
    # return words
```

</details>

---

### Bug 6: Boolean and Integer Collision

```python
def count_distinct_values(data: list) -> int:
    """Count distinct values in a mixed-type list."""
    return len(set(data))

values = [True, 1, False, 0, True, 1.0]
print(f"Distinct values: {count_distinct_values(values)}")
# Expected: 4 (True, 1, False, 0) or 6 (all different)
```

**Hint:** How does Python compare `True` and `1`? What about `1` and `1.0`?

<details>
<summary>Bug & Fix</summary>

**Bug:** `True == 1 == 1.0` and `False == 0` in Python, so the set only contains 2 elements: `{True, False}` (or `{0, 1}`). The result is 2, not 4 or 6.

**Fix:** If you need to distinguish by type, wrap values:
```python
def count_distinct_values(data: list) -> int:
    """Count distinct values, treating different types as different."""
    return len({(type(v).__name__, v) for v in data})

# Or be explicit about the intended behavior
# and document that True == 1 in Python
```

</details>

---

### Bug 7: Shallow Copy of Nested Structure

```python
def copy_user_permissions(
    original: dict[str, set[str]],
) -> dict[str, set[str]]:
    """Create a copy of user permissions."""
    return original.copy()

perms = {"alice": {"read", "write"}, "bob": {"read"}}
copied = copy_user_permissions(perms)

# Modify the copy
copied["alice"].add("admin")

# Check the original
print(f"Original alice perms: {perms['alice']}")
# Expected: {'read', 'write'} — but got {'read', 'write', 'admin'}!
```

**Hint:** What does `.copy()` on a dict copy — the keys, the values, or both?

<details>
<summary>Bug & Fix</summary>

**Bug:** `dict.copy()` creates a shallow copy. The dict is new, but the set values are the same objects. Modifying `copied["alice"]` also modifies `perms["alice"]`.

**Fix:**
```python
def copy_user_permissions(
    original: dict[str, set[str]],
) -> dict[str, set[str]]:
    return {user: perms.copy() for user, perms in original.items()}
    # Or use: import copy; return copy.deepcopy(original)
```

</details>

---

## Hard Bugs

### Bug 8: Broken Hash/Eq Contract

```python
class Product:
    def __init__(self, name: str, price: float):
        self.name = name
        self.price = price

    def __eq__(self, other):
        return isinstance(other, Product) and self.name == other.name

    def __hash__(self):
        return hash((self.name, self.price))  # Includes price in hash

catalog = set()
p1 = Product("Widget", 9.99)
p2 = Product("Widget", 19.99)

catalog.add(p1)
catalog.add(p2)

print(f"Catalog size: {len(catalog)}")
# Expected: 1 (same name means same product)
# Actual: 2 (different hash values!)

print(f"p1 == p2: {p1 == p2}")  # True
print(f"p2 in catalog: {p2 in catalog}")  # Might be False!
```

**Hint:** What is the hash/eq contract? If `a == b`, what must be true about their hashes?

<details>
<summary>Bug & Fix</summary>

**Bug:** The hash/eq contract is violated: `p1 == p2` is `True` (same name), but `hash(p1) != hash(p2)` (different price). This means equal objects can end up in different hash table slots, and lookups may fail.

**Fix:**
```python
class Product:
    def __init__(self, name: str, price: float):
        self.name = name
        self.price = price

    def __eq__(self, other):
        return isinstance(other, Product) and self.name == other.name

    def __hash__(self):
        return hash(self.name)  # Hash must only use fields used in __eq__
```

</details>

---

### Bug 9: Race Condition in Thread-Safe Set

```python
import threading

class SafeSet:
    def __init__(self):
        self._data = set()
        self._lock = threading.Lock()

    def add_if_new(self, item) -> bool:
        """Add item only if it's not already in the set. Return True if added."""
        if item not in self._data:      # Check
            with self._lock:
                self._data.add(item)    # Add
                return True
        return False

# Usage
safe = SafeSet()
results = []

def worker(item):
    result = safe.add_if_new(item)
    results.append(result)

threads = [threading.Thread(target=worker, args=("same_item",)) for _ in range(100)]
for t in threads:
    t.start()
for t in threads:
    t.join()

true_count = results.count(True)
print(f"Added {true_count} times (expected: 1)")
```

**Hint:** Is the check-then-act pattern atomic here?

<details>
<summary>Bug & Fix</summary>

**Bug:** The `if item not in self._data` check happens **outside** the lock. Multiple threads can pass the check before any of them acquire the lock, leading to the item being "added" multiple times (multiple True returns).

**Fix:**
```python
class SafeSet:
    def __init__(self):
        self._data = set()
        self._lock = threading.Lock()

    def add_if_new(self, item) -> bool:
        with self._lock:  # Lock covers BOTH check and add
            if item not in self._data:
                self._data.add(item)
                return True
            return False
```

</details>

---

### Bug 10: Mutating Object After Insertion

```python
class Tag:
    def __init__(self, name: str):
        self.name = name

    def __hash__(self):
        return hash(self.name)

    def __eq__(self, other):
        return isinstance(other, Tag) and self.name == other.name

    def __repr__(self):
        return f"Tag({self.name!r})"

tags = set()
python_tag = Tag("python")
tags.add(python_tag)
print(f"Before rename: {python_tag in tags}")  # True

# Rename the tag
python_tag.name = "python3"  # Mutate the object!
print(f"After rename: {python_tag in tags}")   # False?!
print(f"Tags: {tags}")  # Shows Tag('python3') but can't find it!

# Even the original lookup fails
print(f"Tag('python') in tags: {Tag('python') in tags}")  # False!
```

**Hint:** What happens to the hash table slot when you change the hash of an existing element?

<details>
<summary>Bug & Fix</summary>

**Bug:** After mutating `python_tag.name`, the hash changes but the object is still stored at the old slot (based on `hash("python")`). The set cannot find it at the new hash (`hash("python3")`), and the old slot also does not match because `__eq__` now checks against `"python3"`.

**Fix:**
```python
# Option 1: Make the class immutable
class Tag:
    __slots__ = ("_name",)

    def __init__(self, name: str):
        self._name = name

    @property
    def name(self) -> str:
        return self._name

    def __hash__(self):
        return hash(self._name)

    def __eq__(self, other):
        return isinstance(other, Tag) and self._name == other._name

# Option 2: Remove and re-add when mutating
tags.discard(python_tag)
python_tag.name = "python3"
tags.add(python_tag)
```

</details>

---

### Bug 11: Assuming Set Ordering in Tests

```python
def get_active_features() -> set[str]:
    """Return currently active features."""
    return {"dark_mode", "notifications", "analytics"}

# Test
def test_active_features():
    features = get_active_features()
    feature_list = list(features)

    assert feature_list[0] == "dark_mode"
    assert feature_list[1] == "notifications"
    assert feature_list[2] == "analytics"
    print("Test passed!")

test_active_features()
# Sometimes passes, sometimes fails — flaky test!
```

**Hint:** Do sets guarantee any particular iteration order?

<details>
<summary>Bug & Fix</summary>

**Bug:** Sets are unordered. `list(set)` produces elements in arbitrary order that changes between runs (due to `PYTHONHASHSEED`). The test makes assumptions about ordering that are not guaranteed.

**Fix:**
```python
def test_active_features():
    features = get_active_features()

    # Option 1: Check membership, not order
    assert features == {"dark_mode", "notifications", "analytics"}

    # Option 2: Sort if you need a specific order
    feature_list = sorted(features)
    assert feature_list == ["analytics", "dark_mode", "notifications"]

    print("Test passed!")
```

</details>
