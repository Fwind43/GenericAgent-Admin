package api

import "encoding/json"

// dataURL is the canonical inline attachment field; url remains a remote URL.
// Normalize at JSON boundaries so old history and worker events share the contract.
func normalizeChatAttachmentMaps(files []map[string]interface{}) []map[string]interface{} {
	if files == nil {
		return nil
	}
	out := make([]map[string]interface{}, len(files))
	for i, file := range files {
		if file == nil {
			continue
		}
		copy := make(map[string]interface{}, len(file))
		for k, v := range file {
			copy[k] = v
		}
		if value, _ := copy["dataURL"].(string); value == "" {
			for _, key := range []string{"data_url", "DataURL"} {
				if legacy, ok := copy[key].(string); ok && legacy != "" {
					copy["dataURL"] = legacy
					break
				}
			}
		}
		delete(copy, "data_url")
		delete(copy, "DataURL")
		out[i] = copy
	}
	return out
}

func (m chatMessage) MarshalJSON() ([]byte, error) {
	type plain chatMessage
	m.Files = normalizeChatAttachmentMaps(m.Files)
	return json.Marshal(plain(m))
}

func (m *chatMessage) UnmarshalJSON(data []byte) error {
	type plain chatMessage
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	decoded.Files = normalizeChatAttachmentMaps(decoded.Files)
	*m = chatMessage(decoded)
	return nil
}

func (u *chatUpload) UnmarshalJSON(data []byte) error {
	type plain chatUpload
	var decoded struct {
		plain
		LegacyDataURL string `json:"data_url"`
	}
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	if decoded.DataURL == "" {
		decoded.DataURL = decoded.LegacyDataURL
	}
	*u = chatUpload(decoded.plain)
	return nil
}
