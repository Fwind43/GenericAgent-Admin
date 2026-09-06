package desktop

import (
	"reflect"
	"sort"
	"testing"
)

func TestTaskbarRegistryAggregatesAndRemovesWindows(t *testing.T) {
	var registry taskbarRegistry
	check := func(want taskbarState, handles ...uintptr) {
		t.Helper()
		got, actual := registry.snapshot()
		sort.Slice(actual, func(i, j int) bool { return actual[i] < actual[j] })
		if got != want || len(actual) != len(handles) {
			t.Fatalf("snapshot = %q %v, want %q %v", got, actual, want, handles)
		}
		for i := range handles {
			if actual[i] != handles[i] {
				t.Fatalf("handles = %v, want %v", actual, handles)
			}
		}
	}
	check(taskbarIdle)
	states := []taskbarState{taskbarIdle, taskbarCompleted, taskbarRunning, taskbarFailed, taskbarWaiting}
	for i, state := range states {
		if !registry.set(uintptr(i+1), state) {
			t.Fatalf("first set %q did not change registry", state)
		}
		got, _ := registry.snapshot()
		if got != state {
			t.Fatalf("aggregate = %q, want %q", got, state)
		}
	}
	check(taskbarWaiting, 1, 2, 3, 4, 5)
	registry.remove(5)
	check(taskbarFailed, 1, 2, 3, 4)
	registry.remove(4)
	check(taskbarRunning, 1, 2, 3)
	registry.remove(3)
	check(taskbarCompleted, 1, 2)
	registry.set(2, taskbarIdle)
	check(taskbarIdle, 1, 2)
	registry.remove(1)
	registry.remove(2)
	registry.remove(2)
	check(taskbarIdle)
}

func TestTaskbarRegistryRejectsInvalidAndDeduplicates(t *testing.T) {
	var registry taskbarRegistry
	registry.set(1, taskbarRunning)
	beforeState, beforeHandles := registry.snapshot()
	if registry.set(1, taskbarRunning) {
		t.Fatal("duplicate set must not request redraw")
	}
	if registry.set(2, taskbarState("unknown")) {
		t.Fatal("invalid state accepted")
	}
	afterState, afterHandles := registry.snapshot()
	if beforeState != afterState || !reflect.DeepEqual(beforeHandles, afterHandles) {
		t.Fatal("duplicate or invalid update changed persistent state")
	}
}
