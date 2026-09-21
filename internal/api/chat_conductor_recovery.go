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
	return s.conductorRecoveryReader()(cs)
}

// Request-local reader: never retain disk relationships across requests. In a
// session list, all workers of a parent share one parent decode and lookup.
// The returned closure is used sequentially, not concurrently.
func (s *Server) conductorRecoveryReader() func(chatSession) chatSession {
	parents := make(map[string]chatSession)
	links := make(map[string]map[string]chatConductorChild)
	return func(cs chatSession) chatSession {
		s.SessionMu.Lock()
		defer s.SessionMu.Unlock()
		// Keep the newest two distinct dispatches per worker. Two are needed
		// for equal timestamps and duplicate records of the same dispatch.
		latest := make(map[string][]chatConductorChild)
		for _, child := range cs.ConductorChildren {
			pair := latest[child.SessionID]
			found := false
			for i := range pair {
				if pair[i].DispatchID == child.DispatchID {
					if child.CreatedAt > pair[i].CreatedAt {
						pair[i] = child
					}
					found = true
					break
				}
			}
			if !found {
				pair = append(pair, child)
			}
			for i := len(pair) - 1; i > 0; i-- {
				if pair[i].CreatedAt > pair[i-1].CreatedAt {
					pair[i], pair[i-1] = pair[i-1], pair[i]
				}
			}
			if len(pair) > 2 {
				pair = pair[:2]
			}
			latest[child.SessionID] = pair
		}
		pending := func(parent string, child chatConductorChild) string {
			// A completed earlier dispatch remains valid after its worker is reused.
			if conductorTerminal(child.Status) {
				for _, later := range latest[child.SessionID] {
					if later.DispatchID != child.DispatchID && later.CreatedAt >= child.CreatedAt {
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
				parent, loaded := parents[state.ParentSessionID]
				if !loaded {
					parent, _ = loadChatSession(s.CfgStore.Snapshot(), state.ParentSessionID)
					parents[state.ParentSessionID] = parent
					index := make(map[string]chatConductorChild, len(parent.ConductorChildren))
					for _, child := range parent.ConductorChildren {
						key := conductorOwnershipKey(parent.ID, child.SessionID, child.DispatchID)
						if _, exists := index[key]; !exists {
							index[key] = child
						}
					}
					links[state.ParentSessionID] = index
				}
				if parent.Conductor != nil && parent.Conductor.Role == conductorRoleParent {
					if child, ok := links[state.ParentSessionID][conductorOwnershipKey(parent.ID, cs.ID, state.DispatchID)]; ok {
						state.Recovery = pending(parent.ID, child)
					}
				}
			}
		}
		return cs
	}
}
