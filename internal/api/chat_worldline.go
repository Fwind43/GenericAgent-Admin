package api

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type chatWorldlineNode struct {
	ID                 string   `json:"id"`
	ParentID           *string  `json:"parent_id"`
	Children           []string `json:"children"`
	Depth              int      `json:"depth"`
	Ordinal            int      `json:"ordinal"`
	Title              string   `json:"title"`
	CreatedAt          int64    `json:"created_at"`
	Kind               string   `json:"kind"`
	Files              []string `json:"files"`
	Ago                int64    `json:"ago"`
	RWTag              string   `json:"rw_tag"`
	MappingStatus      string   `json:"mapping_status"`
	UserMessageID      *string  `json:"user_message_id"`
	AssistantMessageID *string  `json:"assistant_message_id"`
	UntrackedChanges   bool     `json:"untracked_changes"`
	UntrackedFiles     []string `json:"untracked_files"`
}

type chatWorldlineTree struct {
	SchemaVersion int                 `json:"schema_version"`
	RootID        *string             `json:"root_id"`
	Head          *string             `json:"head"`
	CurrentPath   []string            `json:"current_path"`
	SidecarStatus string              `json:"sidecar_status"`
	Truncated     bool                `json:"truncated"`
	Nodes         []chatWorldlineNode `json:"nodes"`
}

// chatWorldlineResponse is the private worker RPC/restore shape. Never write it directly to HTTP.
type chatWorldlineResponse struct {
	Type        string                   `json:"type"`
	Action      string                   `json:"action"`
	Tree        chatWorldlineTree        `json:"tree"`
	Result      map[string]interface{}   `json:"result"`
	RawHistory  []map[string]interface{} `json:"raw_history"`
	HistoryInfo []interface{}            `json:"history_info"`
	Working     map[string]interface{}   `json:"working"`
}

type chatWorldlinePublicNode struct {
	ID                 string   `json:"id"`
	ParentID           *string  `json:"parent_id"`
	Children           []string `json:"children"`
	Depth              int      `json:"depth"`
	Ordinal            int      `json:"ordinal"`
	Kind               string   `json:"kind"`
	Title              string   `json:"title"`
	CreatedAt          int64    `json:"created_at"`
	MappingStatus      string   `json:"mapping_status"`
	UserMessageID      *string  `json:"user_message_id"`
	AssistantMessageID *string  `json:"assistant_message_id"`
	UntrackedChanges   bool     `json:"untracked_changes"`
	UntrackedFiles     []string `json:"untracked_files"`
}

type chatWorldlineVersionGroup struct {
	UserMessageID      string  `json:"user_message_id"`
	AssistantMessageID string  `json:"assistant_message_id"`
	NodeID             string  `json:"node_id"`
	PreviousNodeID     *string `json:"previous_node_id"`
	Index              int     `json:"index"`
	Total              int     `json:"total"`
	NextNodeID         *string `json:"next_node_id"`
}

type chatWorldlinePublic struct {
	SchemaVersion       int                                  `json:"schema_version"`
	Available           bool                                 `json:"available"`
	DegradedReason      string                               `json:"degraded_reason"`
	RootID              *string                              `json:"root_id"`
	Head                *string                              `json:"head"`
	CurrentPath         []string                             `json:"current_path"`
	Truncated           bool                                 `json:"truncated"`
	Nodes               []chatWorldlinePublicNode            `json:"nodes"`
	MessageVersions     map[string]chatWorldlineVersionGroup `json:"message_versions"`
	AssistantMessageIDs map[string]string                    `json:"assistant_message_ids"`
}

type chatWorldlineSwitchRequest struct {
	NodeID string `json:"node_id"`
}

func normalizeWorldlineResponse(resp *chatWorldlineResponse) {
	if resp.Tree.CurrentPath == nil {
		resp.Tree.CurrentPath = []string{}
	}
	if resp.Tree.Nodes == nil {
		resp.Tree.Nodes = []chatWorldlineNode{}
	}
	for i := range resp.Tree.Nodes {
		if resp.Tree.Nodes[i].Children == nil {
			resp.Tree.Nodes[i].Children = []string{}
		}
	}
	if resp.Result == nil {
		resp.Result = map[string]interface{}{}
	}
	if resp.RawHistory == nil {
		resp.RawHistory = []map[string]interface{}{}
	}
	if resp.HistoryInfo == nil {
		resp.HistoryInfo = []interface{}{}
	}
	if resp.Working == nil {
		resp.Working = map[string]interface{}{}
	}
}

func publicWorldline(resp chatWorldlineResponse) chatWorldlinePublic {
	schemaVersion := resp.Tree.SchemaVersion
	if schemaVersion == 0 {
		schemaVersion = 1 // compatibility with pre-versioned worker fixtures
	}
	out := chatWorldlinePublic{SchemaVersion: schemaVersion, Available: resp.Tree.RootID != nil && len(resp.Tree.Nodes) > 0,
		RootID: resp.Tree.RootID, Head: resp.Tree.Head, CurrentPath: append([]string{}, resp.Tree.CurrentPath...),
		Truncated: resp.Tree.Truncated, Nodes: []chatWorldlinePublicNode{}, MessageVersions: map[string]chatWorldlineVersionGroup{},
		AssistantMessageIDs: map[string]string{}}
	if resp.Tree.SidecarStatus != "" && resp.Tree.SidecarStatus != "ok" {
		out.DegradedReason = resp.Tree.SidecarStatus
	}
	mapped := map[string][]chatWorldlineNode{}
	for _, node := range resp.Tree.Nodes {
		out.Nodes = append(out.Nodes, chatWorldlinePublicNode{ID: node.ID, ParentID: node.ParentID,
			Children: append([]string{}, node.Children...), Depth: node.Depth, Ordinal: node.Ordinal,
			Kind: node.Kind, Title: node.Title, CreatedAt: node.CreatedAt, MappingStatus: node.MappingStatus,
			UserMessageID: node.UserMessageID, AssistantMessageID: node.AssistantMessageID,
			UntrackedChanges: node.UntrackedChanges,
			UntrackedFiles:   append([]string{}, node.UntrackedFiles...)})
		if node.MappingStatus == "mapped" && node.UserMessageID != nil && node.AssistantMessageID != nil {
			parent := ""
			if node.ParentID != nil {
				parent = *node.ParentID
			}
			mapped[parent] = append(mapped[parent], node)
		}
	}
	for _, node := range resp.Tree.Nodes {
		if node.MappingStatus != "mapped" || node.UserMessageID == nil || node.AssistantMessageID == nil {
			continue
		}
		parent := ""
		if node.ParentID != nil {
			parent = *node.ParentID
		}
		siblings := mapped[parent]
		for i, sibling := range siblings {
			if sibling.ID != node.ID {
				continue
			}
			group := chatWorldlineVersionGroup{UserMessageID: *node.UserMessageID,
				AssistantMessageID: *node.AssistantMessageID, NodeID: node.ID, Index: i + 1, Total: len(siblings)}
			if i > 0 {
				previous := siblings[i-1].ID
				group.PreviousNodeID = &previous
			}
			if i+1 < len(siblings) {
				next := siblings[i+1].ID
				group.NextNodeID = &next
			}
			out.MessageVersions[*node.UserMessageID] = group
			out.AssistantMessageIDs[*node.UserMessageID] = *node.AssistantMessageID
			break
		}
	}
	return out
}

func decodeWorldlineSwitch(r *http.Request, req *chatWorldlineSwitchRequest) error {
	decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(req); err != nil {
		return err
	}
	var extra interface{}
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return fmt.Errorf("request body must contain one JSON object")
		}
		return err
	}
	return nil
}

func validChatWorldlineID(v string) bool {
	if v == "" {
		return false
	}
	for _, c := range v {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return false
		}
	}
	return true
}

func (s *Server) chatWorldlineRPC(sid string, req map[string]interface{}) (chatWorldlineResponse, error) {
	if !validChatWorldlineID(sid) {
		return chatWorldlineResponse{}, fmt.Errorf("invalid worldline session id")
	}
	cs, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		return chatWorldlineResponse{}, err
	}
	if activate, _ := req["activate"].(bool); activate {
		req["history"] = cs.Messages
		req["raw_history"] = cs.RawHistory
		req["history_info"] = cs.HistoryInfo
		req["working"] = cs.Working
	}
	worker, err := s.getChatWorker(sid)
	if err != nil {
		return chatWorldlineResponse{}, err
	}
	worker.Mu.Lock()
	defer worker.Mu.Unlock()
	return s.chatWorldlineRPCLocked(sid, worker, strings.TrimSpace(cs.Workspace), req)
}

func (s *Server) chatWorldlineRPCLocked(sid string, worker *chatWorker, workspace string, req map[string]interface{}) (chatWorldlineResponse, error) {
	req["op"] = "worldline"
	req["sid"] = safeChatID(sid)
	req["ga_root"] = s.CfgStore.Snapshot().GARoot
	req["workspace"] = strings.TrimSpace(workspace)
	if s.chatWorldlineRPCHook != nil {
		if err := s.chatWorldlineRPCHook(sid, req); err != nil {
			return chatWorldlineResponse{}, err
		}
	}
	if err := json.NewEncoder(worker.Stdin).Encode(req); err != nil {
		s.dropChatWorker(sid, worker)
		return chatWorldlineResponse{}, err
	}
	reader := bufio.NewReaderSize(worker.Stdout, 64*1024)
	for {
		line, readErr := readChatWorkerLine(reader)
		line = bytes.TrimSpace(line)
		if len(line) > 0 {
			var envelope struct {
				Type    string `json:"type"`
				Message struct {
					Content string `json:"content"`
				} `json:"message"`
			}
			if err := json.Unmarshal(line, &envelope); err == nil {
				if envelope.Type == "worldline" {
					var resp chatWorldlineResponse
					if err := json.Unmarshal(line, &resp); err != nil {
						return resp, err
					}
					normalizeWorldlineResponse(&resp)
					return resp, nil
				}
				if envelope.Type == "error" {
					if envelope.Message.Content == "" {
						envelope.Message.Content = "worldline worker failed"
					}
					return chatWorldlineResponse{}, fmt.Errorf("%s", envelope.Message.Content)
				}
			}
		}
		if readErr != nil {
			s.dropChatWorker(sid, worker)
			return chatWorldlineResponse{}, readErr
		}
	}
}

func (s *Server) prepareChatWorldlineResend(sid string, token *chatRun, cs *chatSession, sourceUserMessageID string) error {
	if !s.ownsChatRun(sid, token) {
		return fmt.Errorf("worldline edit/resend lost ownership")
	}
	sourceUserMessageID = strings.TrimSpace(sourceUserMessageID)
	if sourceUserMessageID == "" {
		return fmt.Errorf("source user message id is required")
	}
	messageIndex := -1
	for i := range cs.Messages {
		if cs.Messages[i].ID == sourceUserMessageID && cs.Messages[i].Role == "user" {
			messageIndex = i
			break
		}
	}
	if messageIndex < 0 {
		return fmt.Errorf("source user message is not in this session")
	}
	worker, err := s.getChatWorker(sid)
	if err != nil {
		return err
	}
	worker.Mu.Lock()
	defer worker.Mu.Unlock()
	state, err := s.chatWorldlineRPCLocked(sid, worker, strings.TrimSpace(cs.Workspace), map[string]interface{}{
		"action": "state", "activate": true, "history": cs.Messages,
		"raw_history": cs.RawHistory, "history_info": cs.HistoryInfo, "working": cs.Working,
	})
	if err != nil {
		return err
	}
	path := make(map[string]bool, len(state.Tree.CurrentPath))
	for _, nodeID := range state.Tree.CurrentPath {
		path[nodeID] = true
	}
	sourceNodeID := ""
	if state.Result != nil {
		if rawSourceNodes, ok := state.Result["source_nodes"].(map[string]interface{}); ok {
			if nodeID, ok := rawSourceNodes[sourceUserMessageID].(string); ok {
				sourceNodeID = strings.TrimSpace(nodeID)
			}
		}
	}
	if sourceNodeID == "" {
		for _, node := range state.Tree.Nodes {
			if node.MappingStatus == "mapped" && node.UserMessageID != nil && *node.UserMessageID == sourceUserMessageID && path[node.ID] {
				sourceNodeID = node.ID
				break
			}
		}
	}
	if sourceNodeID == "" {
		// Sessions created before worldline bindings have no node to restore.
		// Keep resend safe by falling back to the persisted chat boundary rather
		// than pretending that an unrelated worldline node represents this turn.
		rawHistory := rawHistoryBeforeMessageForResend(*cs, messageIndex)
		if !s.ownsChatRun(sid, token) {
			return fmt.Errorf("worldline edit/resend lost ownership")
		}
		cs.Messages = append([]chatMessage(nil), cs.Messages[:messageIndex]...)
		cs.RawHistory = rawHistory
		cs.HistoryInfo = []interface{}{}
		cs.Working = nil
		return nil
	}
	restored, err := s.chatWorldlineRPCLocked(sid, worker, strings.TrimSpace(cs.Workspace), map[string]interface{}{
		"action": "restore", "node_id": sourceNodeID, "mode": "conversation", "to": "before",
	})
	if err != nil {
		return err
	}
	if !s.ownsChatRun(sid, token) {
		return fmt.Errorf("worldline edit/resend lost ownership")
	}
	// Prefer the exact persisted boundary: worldline deltas may predate
	// tool continuations or have been generated from trimmed model history.
	currentRaw, currentRawErr := rawHistoryBeforeMessage(*cs, messageIndex)
	useCurrentRaw := currentRawErr == nil && len(cs.RawHistory) > 0
	cs.Messages = append([]chatMessage(nil), cs.Messages[:messageIndex]...)
	cs.RawHistory = append([]map[string]interface{}(nil), restored.RawHistory...)
	if useCurrentRaw {
		cs.RawHistory = currentRaw
	}
	cs.HistoryInfo = append([]interface{}(nil), restored.HistoryInfo...)
	cs.Working = mergeChatMaps(nil, restored.Working)
	if restored.Tree.Head != nil {
		cs.WorldlineHead = *restored.Tree.Head
	} else {
		cs.WorldlineHead = ""
	}
	return nil
}

func (s *Server) chatWorldlineState(w http.ResponseWriter, r *http.Request, sid string) {
	if !validChatWorldlineID(sid) {
		bad(w, http.StatusBadRequest, "invalid session id")
		return
	}
	if s.chatRunActive(sid) {
		bad(w, http.StatusConflict, "chat is already running")
		return
	}
	req := map[string]interface{}{"action": "state"}
	if r.URL.Query().Get("activate") == "true" {
		req["activate"] = true
	}
	resp, err := s.chatWorldlineRPC(sid, req)
	if err != nil {
		bad(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, publicWorldline(resp))
}

func (s *Server) chatWorldlineSwitch(w http.ResponseWriter, r *http.Request, sid string) {
	var req chatWorldlineSwitchRequest
	if err := decodeWorldlineSwitch(r, &req); err != nil {
		bad(w, http.StatusBadRequest, err.Error())
		return
	}
	req.NodeID = strings.TrimSpace(req.NodeID)
	if !validChatWorldlineID(sid) || !validChatWorldlineID(req.NodeID) {
		bad(w, http.StatusBadRequest, "valid session id and node_id are required")
		return
	}
	token := s.beginChatRun(sid)
	if token == nil {
		bad(w, http.StatusConflict, "chat is already running")
		return
	}
	defer s.endChatRunOwned(sid, token)
	resp, err := s.chatWorldlineRPC(sid, map[string]interface{}{"action": "restore_mapped", "node_id": req.NodeID})
	if err != nil {
		bad(w, http.StatusBadRequest, err.Error())
		return
	}
	if !s.ownsChatRun(sid, token) {
		bad(w, http.StatusConflict, "worldline switch lost ownership")
		return
	}
	cs, err := loadChatSession(s.CfgStore.Snapshot(), sid)
	if err != nil {
		bad(w, http.StatusInternalServerError, err.Error())
		return
	}
	if display, ok := resp.Result["display_path"]; ok {
		data, err := json.Marshal(display)
		if err != nil || json.Unmarshal(data, &cs.Messages) != nil {
			bad(w, http.StatusInternalServerError, "invalid mapped display path")
			return
		}
	} else {
		bad(w, http.StatusBadRequest, "worldline node has no Admin display path")
		return
	}
	cs.RawHistory, cs.HistoryInfo, cs.Working = resp.RawHistory, resp.HistoryInfo, resp.Working
	cs.WorldlineHead = req.NodeID
	if !s.ownsChatRun(sid, token) {
		bad(w, http.StatusConflict, "worldline switch lost ownership")
		return
	}
	if err := s.saveChatSessionExact(cs); err != nil {
		bad(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, map[string]interface{}{"ok": true, "session": chatSessionForClient(cs), "worldline": publicWorldline(resp)})
}
