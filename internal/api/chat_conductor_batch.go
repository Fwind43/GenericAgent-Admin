package api

import "strings"

// Only coalesce an automatic, contiguous prefix; never reorder user messages.
// The first item always makes progress even if it alone exceeds the byte budget.
func conductorCompletionBatchCount(cs chatSession, index int, queueID string) int {
	if queueID != "" || index != 0 || cs.Conductor == nil || cs.Conductor.Role != conductorRoleParent {
		return 1
	}
	first := cs.QueuedMessages[index]
	if first.Kind != "conductor_completion" || len(first.Files) != 0 {
		return 1
	}
	count, size := 1, len(first.Text)
	for _, next := range cs.QueuedMessages[index+1:] {
		if count >= 8 || next.Kind != first.Kind || next.LLMNo != first.LLMNo || next.ReasoningEffort != first.ReasoningEffort || len(next.Files) != 0 || size+len(next.Text)+2 > 64*1024 {
			break
		}
		count++
		size += len(next.Text) + 2
	}
	return count
}

func chatRunContainsQueueID(run *chatRun, id string) bool {
	if run == nil {
		return false
	}
	if run.QueueID == id {
		return true
	}
	for _, item := range run.QueueIDs {
		if item == id {
			return true
		}
	}
	return false
}

func prepareConductorCompletionBatch(req map[string]interface{}, cs chatSession, batch []chatQueuedMessage) {
	texts := make([]string, 0, len(batch))
	receipts := make([]chatConductorChild, 0, len(batch))
	for _, item := range batch {
		texts = append(texts, item.Text)
		dispatchID := strings.TrimPrefix(item.ID, "conductor-")
		if idx := conductorFindChild(cs.ConductorChildren, dispatchID); idx >= 0 {
			receipts = append(receipts, cs.ConductorChildren[idx])
		}
	}
	req["prompt"] = strings.Join(texts, "\n\n")
	req["conductor_completion_receipts"] = receipts
	// Keep the legacy single-result field for single events only.
	if len(batch) == 1 && len(receipts) == 1 {
		req["conductor_completion_receipt"] = receipts[0]
	}
}
