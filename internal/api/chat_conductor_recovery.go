package api

// Ownership is deliberately process-local. A disk record, PID or absent local
// run is not evidence that another Admin process has stopped.
func conductorOwnershipKey(parent, worker, dispatch string) string {
	return parent + "\x00" + worker + "\x00" + dispatch
}

// Caller holds SessionMu.
func (s *Server) ownsConductorDispatch(parent, worker, dispatch string) bool {
	return s.ChatRuntime != nil && s.ChatRuntime.conductorOwned[conductorOwnershipKey(parent, worker, dispatch)]
}

// Response-only copy: never pass this result to a persistence function. Both
// relationship ends must agree before this instance can describe a runtime.
func (s *Server) conductorRecoveryView(cs chatSession) chatSession {
	s.SessionMu.Lock()
	defer s.SessionMu.Unlock()
	pending := func(parent string, child chatConductorChild) string {
		// A completed earlier dispatch remains valid after its worker is reused.
		if conductorTerminal(child.Status) {
			for _, later := range cs.ConductorChildren {
				if later.SessionID == child.SessionID && later.DispatchID != child.DispatchID && later.CreatedAt >= child.CreatedAt {
					return ""
				}
			}
		}
		worker, err := s.loadChatSessionSummary(s.CfgStore.Snapshot(), child.SessionID)
		if err != nil || worker.Conductor == nil || worker.Conductor.Role != conductorRoleWorker || worker.Conductor.ParentSessionID != parent || worker.Conductor.DispatchID != child.DispatchID || worker.Conductor.Status != child.Status {
			return "pending_confirmation"
		}
		if !conductorTerminal(child.Status) {
			if !s.ownsConductorDispatch(parent, child.SessionID, child.DispatchID) {
				return "pending_confirmation"
			}
			if child.Status != conductorQueued {
				running, _, _ := s.chatRunState(child.SessionID)
				if !running {
					return "pending_confirmation"
				}
			}
		}
		return ""
	}
	cs.ConductorChildren = append([]chatConductorChild(nil), cs.ConductorChildren...)
	for i := range cs.ConductorChildren {
		cs.ConductorChildren[i].Recovery = pending(cs.ID, cs.ConductorChildren[i])
	}
	if cs.Conductor != nil {
		state := *cs.Conductor
		cs.Conductor = &state
		if state.Role == conductorRoleWorker {
			state.Recovery = "pending_confirmation"
			parent, err := loadChatSession(s.CfgStore.Snapshot(), state.ParentSessionID)
			if err == nil && parent.Conductor != nil && parent.Conductor.Role == conductorRoleParent {
				for _, child := range parent.ConductorChildren {
					if child.DispatchID == state.DispatchID && child.SessionID == cs.ID {
						state.Recovery = pending(parent.ID, child)
						break
					}
				}
			}
		}
	}
	return cs
}
