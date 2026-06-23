# Sets — Practice Tasks

---

## Junior Tasks (3-4)

### Task 1: Unique Word Counter

**Difficulty:** Easy
**Goal:** Count unique words in a text.

```python
def count_unique_words(text: str) -> int:
    """Count the number of unique words in the text (case-insensitive).

    Args:
        text: Input string with words separated by spaces.

    Returns:
        Number of unique words.

    Examples:
        >>> count_unique_words("hello world hello")
        2
        >>> count_unique_words("Python python PYTHON")
        1
        >>> count_unique_words("")
        0
    """
    # YOUR CODE HERE
    pass
```

<details>
<summary>Solution</summary>

```python
def count_unique_words(text: str) -> int:
    if not text.strip():
        return 0
    words = text.lower().split()
    return len(set(words))


# Tests
assert count_unique_words("hello world hello") == 2
assert count_unique_words("Python python PYTHON") == 1
assert count_unique_words("") == 0
assert count_unique_words("a b c d e") == 5
print("All tests passed!")
```

</details>

---

### Task 2: Common Friends

**Difficulty:** Easy
**Goal:** Find mutual friends between two users.

```python
def find_mutual_friends(
    user_a_friends: set[str],
    user_b_friends: set[str],
) -> set[str]:
    """Find friends that both users have in common.

    Examples:
        >>> find_mutual_friends({"Alice", "Bob", "Charlie"}, {"Bob", "Charlie", "Diana"})
        {'Bob', 'Charlie'}
        >>> find_mutual_friends({"Alice"}, {"Bob"})
        set()
    """
    # YOUR CODE HERE
    pass


def suggest_friends(
    user_friends: set[str],
    other_friends: set[str],
) -> set[str]:
    """Suggest friends that the user doesn't have yet.

    Examples:
        >>> suggest_friends({"Alice", "Bob"}, {"Bob", "Charlie", "Diana"})
        {'Charlie', 'Diana'}
    """
    # YOUR CODE HERE
    pass
```

<details>
<summary>Solution</summary>

```python
def find_mutual_friends(
    user_a_friends: set[str],
    user_b_friends: set[str],
) -> set[str]:
    return user_a_friends & user_b_friends


def suggest_friends(
    user_friends: set[str],
    other_friends: set[str],
) -> set[str]:
    return other_friends - user_friends


# Tests
assert find_mutual_friends({"Alice", "Bob", "Charlie"}, {"Bob", "Charlie", "Diana"}) == {"Bob", "Charlie"}
assert find_mutual_friends({"Alice"}, {"Bob"}) == set()
assert suggest_friends({"Alice", "Bob"}, {"Bob", "Charlie", "Diana"}) == {"Charlie", "Diana"}
print("All tests passed!")
```

</details>

---

### Task 3: Remove Duplicates Preserving Order

**Difficulty:** Easy-Medium
**Goal:** Remove duplicate elements from a list while keeping the original order.

```python
def deduplicate(items: list) -> list:
    """Remove duplicates from a list while preserving the original order.

    Examples:
        >>> deduplicate([3, 1, 2, 1, 3, 4, 2])
        [3, 1, 2, 4]
        >>> deduplicate(["a", "b", "a", "c", "b"])
        ['a', 'b', 'c']
        >>> deduplicate([])
        []
    """
    # YOUR CODE HERE
    pass
```

<details>
<summary>Solution</summary>

```python
def deduplicate(items: list) -> list:
    seen = set()
    result = []
    for item in items:
        if item not in seen:
            seen.add(item)
            result.append(item)
    return result


# Tests
assert deduplicate([3, 1, 2, 1, 3, 4, 2]) == [3, 1, 2, 4]
assert deduplicate(["a", "b", "a", "c", "b"]) == ["a", "b", "c"]
assert deduplicate([]) == []
assert deduplicate([1]) == [1]
print("All tests passed!")
```

</details>

---

### Task 4: Pangram Checker

**Difficulty:** Easy-Medium
**Goal:** Check if a sentence contains every letter of the alphabet.

```python
def is_pangram(sentence: str) -> bool:
    """Check if the sentence is a pangram (contains every letter a-z).

    Examples:
        >>> is_pangram("The quick brown fox jumps over the lazy dog")
        True
        >>> is_pangram("Hello World")
        False
    """
    # YOUR CODE HERE
    pass


def missing_letters(sentence: str) -> set[str]:
    """Return the set of lowercase letters NOT present in the sentence.

    Examples:
        >>> missing_letters("hello world")
        {'a', 'b', 'c', 'f', 'g', 'i', 'j', 'k', 'm', 'n', 'p', 'q', 's', 't', 'u', 'v', 'x', 'y', 'z'}
    """
    # YOUR CODE HERE
    pass
```

<details>
<summary>Solution</summary>

```python
import string


def is_pangram(sentence: str) -> bool:
    return set(string.ascii_lowercase) <= set(sentence.lower())


def missing_letters(sentence: str) -> set[str]:
    return set(string.ascii_lowercase) - set(sentence.lower())


# Tests
assert is_pangram("The quick brown fox jumps over the lazy dog")
assert not is_pangram("Hello World")
assert missing_letters("abcdefghijklmnopqrstuvwxy") == {"z"}
print("All tests passed!")
```

</details>

---

## Middle Tasks (2-3)

### Task 5: Set-Based Access Control

**Difficulty:** Medium
**Goal:** Implement a role-based access control system using sets.

```python
from typing import Optional


class RBAC:
    """Role-Based Access Control using sets.

    Example usage:
        rbac = RBAC()
        rbac.add_role("admin", {"read", "write", "delete", "manage_users"})
        rbac.add_role("editor", {"read", "write"})
        rbac.add_role("viewer", {"read"})

        rbac.assign_role("alice", "admin")
        rbac.assign_role("bob", "editor")
        rbac.assign_role("bob", "viewer")  # Bob has both roles

        assert rbac.has_permission("alice", "delete") == True
        assert rbac.has_permission("bob", "delete") == False
        assert rbac.get_permissions("bob") == {"read", "write"}
        assert rbac.users_with_permission("write") == {"alice", "bob"}
    """

    def __init__(self):
        # YOUR CODE HERE — define internal data structures
        pass

    def add_role(self, role: str, permissions: set[str]) -> None:
        """Define a role with a set of permissions."""
        pass

    def assign_role(self, user: str, role: str) -> None:
        """Assign a role to a user."""
        pass

    def revoke_role(self, user: str, role: str) -> None:
        """Remove a role from a user."""
        pass

    def has_permission(self, user: str, permission: str) -> bool:
        """Check if a user has a specific permission."""
        pass

    def get_permissions(self, user: str) -> set[str]:
        """Get all permissions for a user (aggregated from all roles)."""
        pass

    def users_with_permission(self, permission: str) -> set[str]:
        """Find all users who have a specific permission."""
        pass
```

<details>
<summary>Solution</summary>

```python
from collections import defaultdict


class RBAC:
    def __init__(self):
        self._roles: dict[str, frozenset[str]] = {}
        self._user_roles: dict[str, set[str]] = defaultdict(set)

    def add_role(self, role: str, permissions: set[str]) -> None:
        self._roles[role] = frozenset(permissions)

    def assign_role(self, user: str, role: str) -> None:
        if role not in self._roles:
            raise ValueError(f"Role '{role}' does not exist")
        self._user_roles[user].add(role)

    def revoke_role(self, user: str, role: str) -> None:
        self._user_roles[user].discard(role)

    def has_permission(self, user: str, permission: str) -> bool:
        return permission in self.get_permissions(user)

    def get_permissions(self, user: str) -> set[str]:
        perms: set[str] = set()
        for role in self._user_roles.get(user, set()):
            perms |= self._roles.get(role, frozenset())
        return perms

    def users_with_permission(self, permission: str) -> set[str]:
        return {
            user
            for user, roles in self._user_roles.items()
            if any(permission in self._roles.get(r, frozenset()) for r in roles)
        }


# Tests
rbac = RBAC()
rbac.add_role("admin", {"read", "write", "delete", "manage_users"})
rbac.add_role("editor", {"read", "write"})
rbac.add_role("viewer", {"read"})

rbac.assign_role("alice", "admin")
rbac.assign_role("bob", "editor")
rbac.assign_role("bob", "viewer")

assert rbac.has_permission("alice", "delete") == True
assert rbac.has_permission("bob", "delete") == False
assert rbac.get_permissions("bob") == {"read", "write"}
assert rbac.users_with_permission("write") == {"alice", "bob"}

rbac.revoke_role("bob", "editor")
assert rbac.get_permissions("bob") == {"read"}
print("All tests passed!")
```

</details>

---

### Task 6: Graph Connectivity Checker

**Difficulty:** Medium
**Goal:** Determine if all nodes in a graph are connected using set-based BFS.

```python
def are_connected(
    graph: dict[str, set[str]],
    start: str,
    end: str,
) -> bool:
    """Check if there is a path from start to end in the graph.

    Args:
        graph: Adjacency list represented as {node: {neighbors}}
        start: Starting node
        end: Target node

    Examples:
        >>> g = {"A": {"B"}, "B": {"A", "C"}, "C": {"B"}, "D": set()}
        >>> are_connected(g, "A", "C")
        True
        >>> are_connected(g, "A", "D")
        False
    """
    # YOUR CODE HERE
    pass


def find_all_connected_components(
    graph: dict[str, set[str]],
) -> list[set[str]]:
    """Find all connected components in the graph.

    Examples:
        >>> g = {"A": {"B"}, "B": {"A"}, "C": {"D"}, "D": {"C"}, "E": set()}
        >>> sorted([sorted(c) for c in find_all_connected_components(g)])
        [['A', 'B'], ['C', 'D'], ['E']]
    """
    # YOUR CODE HERE
    pass
```

<details>
<summary>Solution</summary>

```python
def are_connected(
    graph: dict[str, set[str]],
    start: str,
    end: str,
) -> bool:
    if start == end:
        return True

    visited: set[str] = set()
    queue = [start]

    while queue:
        node = queue.pop(0)
        if node == end:
            return True
        if node not in visited:
            visited.add(node)
            queue.extend(graph.get(node, set()) - visited)

    return False


def find_all_connected_components(
    graph: dict[str, set[str]],
) -> list[set[str]]:
    visited: set[str] = set()
    components: list[set[str]] = []

    for node in graph:
        if node not in visited:
            component: set[str] = set()
            stack = [node]
            while stack:
                current = stack.pop()
                if current not in visited:
                    visited.add(current)
                    component.add(current)
                    stack.extend(graph.get(current, set()) - visited)
            components.append(component)

    return components


# Tests
g = {"A": {"B"}, "B": {"A", "C"}, "C": {"B"}, "D": set()}
assert are_connected(g, "A", "C") == True
assert are_connected(g, "A", "D") == False

g2 = {"A": {"B"}, "B": {"A"}, "C": {"D"}, "D": {"C"}, "E": set()}
components = find_all_connected_components(g2)
assert len(components) == 3
assert {"A", "B"} in components
assert {"C", "D"} in components
assert {"E"} in components
print("All tests passed!")
```

</details>

---

### Task 7: Change Detection System

**Difficulty:** Medium
**Goal:** Track changes between two states of a system.

```python
from typing import TypedDict


class ChangeReport(TypedDict):
    added: set[str]
    removed: set[str]
    unchanged: set[str]


def detect_changes(old_state: set[str], new_state: set[str]) -> ChangeReport:
    """Detect what was added, removed, and unchanged between two states.

    Examples:
        >>> report = detect_changes({"a", "b", "c"}, {"b", "c", "d"})
        >>> report["added"] == {"d"}
        True
        >>> report["removed"] == {"a"}
        True
        >>> report["unchanged"] == {"b", "c"}
        True
    """
    # YOUR CODE HERE
    pass


def apply_changes(
    current: set[str],
    to_add: set[str],
    to_remove: set[str],
) -> tuple[set[str], ChangeReport]:
    """Apply changes and return the new state with a report.

    Should only add items not already present and
    only remove items that exist.
    """
    # YOUR CODE HERE
    pass
```

<details>
<summary>Solution</summary>

```python
def detect_changes(old_state: set[str], new_state: set[str]) -> ChangeReport:
    return {
        "added": new_state - old_state,
        "removed": old_state - new_state,
        "unchanged": old_state & new_state,
    }


def apply_changes(
    current: set[str],
    to_add: set[str],
    to_remove: set[str],
) -> tuple[set[str], ChangeReport]:
    old = current.copy()
    actually_added = to_add - current
    actually_removed = to_remove & current

    new_state = (current | actually_added) - actually_removed
    report: ChangeReport = {
        "added": actually_added,
        "removed": actually_removed,
        "unchanged": current & new_state,
    }
    return new_state, report


# Tests
report = detect_changes({"a", "b", "c"}, {"b", "c", "d"})
assert report["added"] == {"d"}
assert report["removed"] == {"a"}
assert report["unchanged"] == {"b", "c"}

new_state, report = apply_changes({"a", "b"}, {"c", "d"}, {"a", "z"})
assert new_state == {"b", "c", "d"}
assert report["added"] == {"c", "d"}
assert report["removed"] == {"a"}
print("All tests passed!")
```

</details>

---

## Senior Tasks (2-3)

### Task 8: Bloom Filter Implementation

**Difficulty:** Hard
**Goal:** Implement a probabilistic set (Bloom filter) from scratch.

```python
class BloomFilter:
    """A space-efficient probabilistic data structure.

    Supports:
        - add(item): Add an item
        - __contains__(item): Check membership (may have false positives)
        - estimated_false_positive_rate: Current estimated FP rate

    Example:
        bf = BloomFilter(expected_items=1000, fp_rate=0.01)
        bf.add("hello")
        assert "hello" in bf      # Always True
        assert "world" not in bf   # True (probably)
    """

    def __init__(self, expected_items: int, fp_rate: float = 0.01):
        # YOUR CODE HERE
        pass

    def add(self, item) -> None:
        pass

    def __contains__(self, item) -> bool:
        pass

    @property
    def estimated_false_positive_rate(self) -> float:
        pass
```

<details>
<summary>Solution</summary>

```python
import math
import hashlib


class BloomFilter:
    def __init__(self, expected_items: int, fp_rate: float = 0.01):
        self.expected = expected_items
        self.fp_rate = fp_rate
        self.size = self._optimal_size(expected_items, fp_rate)
        self.hash_count = self._optimal_hashes(self.size, expected_items)
        self.bits = bytearray(self.size)
        self._count = 0

    @staticmethod
    def _optimal_size(n: int, p: float) -> int:
        return max(1, int(-n * math.log(p) / (math.log(2) ** 2)))

    @staticmethod
    def _optimal_hashes(m: int, n: int) -> int:
        return max(1, int((m / n) * math.log(2)))

    def _get_positions(self, item) -> list[int]:
        encoded = str(item).encode("utf-8")
        positions = []
        for i in range(self.hash_count):
            h = hashlib.sha256(encoded + i.to_bytes(4, "big")).hexdigest()
            positions.append(int(h, 16) % self.size)
        return positions

    def add(self, item) -> None:
        for pos in self._get_positions(item):
            self.bits[pos] = 1
        self._count += 1

    def __contains__(self, item) -> bool:
        return all(self.bits[pos] for pos in self._get_positions(item))

    @property
    def estimated_false_positive_rate(self) -> float:
        if self._count == 0:
            return 0.0
        exponent = -self.hash_count * self._count / self.size
        return (1 - math.exp(exponent)) ** self.hash_count


# Tests
bf = BloomFilter(expected_items=10000, fp_rate=0.01)
for i in range(10000):
    bf.add(f"item_{i}")

# Test membership (no false negatives)
for i in range(10000):
    assert f"item_{i}" in bf, f"False negative for item_{i}"

# Test false positive rate
false_positives = sum(
    1 for i in range(10000, 20000)
    if f"item_{i}" in bf
)
actual_fp_rate = false_positives / 10000
print(f"Expected FP rate: {bf.fp_rate}")
print(f"Actual FP rate:   {actual_fp_rate:.4f}")
print(f"Estimated FP rate: {bf.estimated_false_positive_rate:.4f}")
assert actual_fp_rate < 0.05, f"FP rate too high: {actual_fp_rate}"
print("All tests passed!")
```

</details>

---

### Task 9: Thread-Safe Set with Snapshot Iteration

**Difficulty:** Hard
**Goal:** Implement a set that can be safely used from multiple threads.

```python
import threading
from typing import TypeVar, Generic, Iterator

T = TypeVar("T")


class ConcurrentSet(Generic[T]):
    """A thread-safe set that supports concurrent read/write access.

    Features:
        - Thread-safe add, remove, contains
        - Atomic check-and-add
        - Snapshot iteration (iterates over a copy)
        - Batch operations (update, difference_update)

    Example:
        cs = ConcurrentSet[int]()
        cs.add(1)
        cs.add(2)
        assert 1 in cs
        assert cs.add_if_absent(3) == True
        assert cs.add_if_absent(3) == False
    """

    def __init__(self):
        # YOUR CODE HERE
        pass

    def add(self, item: T) -> None:
        pass

    def remove(self, item: T) -> bool:
        pass

    def __contains__(self, item: T) -> bool:
        pass

    def add_if_absent(self, item: T) -> bool:
        pass

    def snapshot(self) -> frozenset[T]:
        pass

    def __iter__(self) -> Iterator[T]:
        pass

    def __len__(self) -> int:
        pass
```

<details>
<summary>Solution</summary>

```python
import threading
from typing import TypeVar, Generic, Iterator

T = TypeVar("T")


class ConcurrentSet(Generic[T]):
    def __init__(self):
        self._data: set[T] = set()
        self._lock = threading.RLock()

    def add(self, item: T) -> None:
        with self._lock:
            self._data.add(item)

    def remove(self, item: T) -> bool:
        with self._lock:
            if item in self._data:
                self._data.discard(item)
                return True
            return False

    def __contains__(self, item: T) -> bool:
        with self._lock:
            return item in self._data

    def add_if_absent(self, item: T) -> bool:
        with self._lock:
            if item not in self._data:
                self._data.add(item)
                return True
            return False

    def snapshot(self) -> frozenset[T]:
        with self._lock:
            return frozenset(self._data)

    def __iter__(self) -> Iterator[T]:
        return iter(self.snapshot())

    def __len__(self) -> int:
        with self._lock:
            return len(self._data)

    def update(self, items: set[T]) -> None:
        with self._lock:
            self._data |= items

    def difference_update(self, items: set[T]) -> None:
        with self._lock:
            self._data -= items


# Multi-threaded test
cs = ConcurrentSet[int]()
errors = []

def adder(start: int, count: int):
    try:
        for i in range(start, start + count):
            cs.add(i)
    except Exception as e:
        errors.append(e)

threads = [threading.Thread(target=adder, args=(i * 1000, 1000)) for i in range(10)]
for t in threads:
    t.start()
for t in threads:
    t.join()

assert not errors
assert len(cs) == 10000
assert cs.add_if_absent(0) == False
assert cs.add_if_absent(99999) == True
print("All tests passed!")
```

</details>

---

## Questions (5-10)

1. Why does `set()` require hashable elements but `list()` does not?
2. What is the average and worst-case time complexity of `x in my_set`?
3. How does Python handle hash collisions in sets?
4. Why can't you use a list as a set element, but you can use a tuple?
5. What happens when you iterate over a set — is the order guaranteed?
6. What is the difference between `{1, 2, 3} - {2}` and `{1, 2, 3}.difference([2])`?
7. When would you prefer `frozenset` over `set`?
8. Why does `{True, 1}` have length 1?
9. How does `PYTHONHASHSEED` affect set behavior?
10. What is the load factor of a Python set, and why does it matter?

---

## Mini Projects (1+)

### Mini Project: Tag-Based File Organizer

Build a command-line tool that organizes files using tags (stored as sets).

**Requirements:**
- Add/remove tags for files
- Find files by tag intersection (files with ALL specified tags)
- Find files by tag union (files with ANY specified tag)
- Show files exclusive to certain tags
- Display tag statistics (most used tags, orphan files)

```python
class TagFileManager:
    """Tag-based file organization system.

    Usage:
        manager = TagFileManager()
        manager.tag_file("report.pdf", {"work", "finance"})
        manager.tag_file("vacation.jpg", {"personal", "photos"})
        manager.tag_file("budget.xlsx", {"work", "finance"})

        manager.find_by_all_tags({"work", "finance"})  # report.pdf, budget.xlsx
        manager.find_by_any_tag({"photos"})             # vacation.jpg
        manager.get_tags("report.pdf")                  # {"work", "finance"}
        manager.most_popular_tags(3)                    # [("work", 2), ...]
    """
    pass
```

<details>
<summary>Solution</summary>

```python
from collections import Counter, defaultdict


class TagFileManager:
    def __init__(self):
        self._file_tags: dict[str, set[str]] = {}
        self._tag_files: dict[str, set[str]] = defaultdict(set)

    def tag_file(self, filename: str, tags: set[str]) -> None:
        if filename not in self._file_tags:
            self._file_tags[filename] = set()
        self._file_tags[filename] |= tags
        for tag in tags:
            self._tag_files[tag].add(filename)

    def untag_file(self, filename: str, tags: set[str]) -> None:
        if filename in self._file_tags:
            self._file_tags[filename] -= tags
            for tag in tags:
                self._tag_files[tag].discard(filename)

    def get_tags(self, filename: str) -> set[str]:
        return self._file_tags.get(filename, set()).copy()

    def find_by_all_tags(self, tags: set[str]) -> set[str]:
        if not tags:
            return set(self._file_tags.keys())
        tag_list = list(tags)
        result = self._tag_files.get(tag_list[0], set()).copy()
        for tag in tag_list[1:]:
            result &= self._tag_files.get(tag, set())
        return result

    def find_by_any_tag(self, tags: set[str]) -> set[str]:
        result: set[str] = set()
        for tag in tags:
            result |= self._tag_files.get(tag, set())
        return result

    def find_exclusive(self, tag: str) -> set[str]:
        """Files that have ONLY this tag."""
        return {
            f for f in self._tag_files.get(tag, set())
            if self._file_tags[f] == {tag}
        }

    def most_popular_tags(self, n: int = 5) -> list[tuple[str, int]]:
        counter = Counter({tag: len(files) for tag, files in self._tag_files.items()})
        return counter.most_common(n)

    def orphan_files(self) -> set[str]:
        """Files with no tags."""
        return {f for f, tags in self._file_tags.items() if not tags}


# Test
manager = TagFileManager()
manager.tag_file("report.pdf", {"work", "finance"})
manager.tag_file("vacation.jpg", {"personal", "photos"})
manager.tag_file("budget.xlsx", {"work", "finance"})
manager.tag_file("notes.txt", {"work"})

assert manager.find_by_all_tags({"work", "finance"}) == {"report.pdf", "budget.xlsx"}
assert manager.find_by_any_tag({"photos"}) == {"vacation.jpg"}
assert manager.get_tags("report.pdf") == {"work", "finance"}
assert manager.most_popular_tags(1) == [("work", 3)]
print("All tests passed!")
```

</details>

---

## Challenge (1)

### Challenge: Implement a Power Set Generator

Generate the power set (all subsets) of a given set using both iterative and recursive approaches. Compare performance for sets of size 10, 15, and 20.

```python
def power_set_iterative(s: set) -> set[frozenset]:
    """Generate all subsets of a set iteratively.

    >>> sorted(power_set_iterative({1, 2}), key=len)
    [frozenset(), frozenset({1}), frozenset({2}), frozenset({1, 2})]
    """
    # YOUR CODE HERE
    pass


def power_set_recursive(s: set) -> set[frozenset]:
    """Generate all subsets of a set recursively."""
    # YOUR CODE HERE
    pass


def power_set_bitmask(s: set) -> set[frozenset]:
    """Generate all subsets using bitmask enumeration."""
    # YOUR CODE HERE
    pass
```

<details>
<summary>Solution</summary>

```python
import timeit


def power_set_iterative(s: set) -> set[frozenset]:
    result: set[frozenset] = {frozenset()}
    for elem in s:
        new_subsets = {subset | frozenset({elem}) for subset in result}
        result |= new_subsets
    return result


def power_set_recursive(s: set) -> set[frozenset]:
    if not s:
        return {frozenset()}
    elem = next(iter(s))
    rest = s - {elem}
    without = power_set_recursive(rest)
    with_elem = {subset | frozenset({elem}) for subset in without}
    return without | with_elem


def power_set_bitmask(s: set) -> set[frozenset]:
    items = list(s)
    n = len(items)
    result: set[frozenset] = set()
    for mask in range(1 << n):
        subset = frozenset(items[i] for i in range(n) if mask & (1 << i))
        result.add(subset)
    return result


# Verification
s = {1, 2, 3}
assert power_set_iterative(s) == power_set_recursive(s) == power_set_bitmask(s)
assert len(power_set_iterative(s)) == 8  # 2^3

# Benchmark
for size in [10, 15, 18]:
    test_set = set(range(size))
    print(f"\nSize {size} (2^{size} = {2**size:,} subsets):")

    for name, func in [
        ("iterative", power_set_iterative),
        ("recursive", power_set_recursive),
        ("bitmask", power_set_bitmask),
    ]:
        try:
            t = timeit.timeit(lambda: func(test_set), number=1)
            print(f"  {name:12s}: {t:.4f}s")
        except RecursionError:
            print(f"  {name:12s}: RecursionError")

print("\nAll tests passed!")
```

</details>
