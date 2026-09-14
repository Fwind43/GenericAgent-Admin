package api

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestChatAttachmentContract(t *testing.T) {
	for _, key := range []string{"data_url", "DataURL", "dataURL"} {
		t.Run(key, func(t *testing.T) {
			raw := `{"id":"u","role":"user","files":[{"name":"x.png","type":"image/png","` + key + `":"data:image/png;base64,eA==","url":"/image","path":"keep"}]}`
			var msg chatMessage
			if err := json.Unmarshal([]byte(raw), &msg); err != nil {
				t.Fatal(err)
			}
			if msg.Files[0]["dataURL"] != "data:image/png;base64,eA==" {
				t.Fatal(msg.Files)
			}
			first, err := json.Marshal(msg)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(first), `"data_url"`) || strings.Contains(string(first), `"DataURL"`) {
				t.Fatal(string(first))
			}
			var again chatMessage
			if err := json.Unmarshal(first, &again); err != nil {
				t.Fatal(err)
			}
			second, _ := json.Marshal(again)
			if string(first) != string(second) {
				t.Fatal("non-idempotent round trip")
			}
			if again.Files[0]["path"] != "keep" || again.Files[0]["url"] != "/image" {
				t.Fatal(again.Files)
			}
			var upload chatUpload
			if err := json.Unmarshal([]byte(`{"name":"x.png","`+key+`":"inline"}`), &upload); err != nil {
				t.Fatal(err)
			}
			if upload.DataURL != "inline" {
				t.Fatal(upload)
			}
			saved, _ := json.Marshal(upload)
			if !strings.Contains(string(saved), `"dataURL":"inline"`) || strings.Contains(string(saved), `"data_url"`) {
				t.Fatal(string(saved))
			}
			maps := convertChatUploadsToMaps([]chatUpload{upload})
			if maps[0]["dataURL"] != "inline" {
				t.Fatal(maps)
			}
		})
	}
	original := []map[string]interface{}{{"data_url": "old", "dataURL": "new"}}
	normalized := normalizeChatAttachmentMaps(original)
	if normalized[0]["dataURL"] != "new" || original[0]["data_url"] != "old" {
		t.Fatal("precedence or mutation")
	}
	if !reflect.DeepEqual(normalized, normalizeChatAttachmentMaps(normalized)) {
		t.Fatal("not idempotent")
	}
	// Worker-created maps are normalized on serialization, not just on history reads.
	b, _ := json.Marshal(chatMessage{Files: []map[string]interface{}{{"data_url": "worker"}}})
	if strings.Contains(string(b), `"data_url"`) || !strings.Contains(string(b), `"dataURL":"worker"`) {
		t.Fatal(string(b))
	}
}
