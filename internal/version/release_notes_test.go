package version

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestReleaseNotesSurviveCheckAndStatusJSON(t *testing.T) {
	const payload = `{"tag_name":"v1.2.3","body":"## Changes\n- Fixed updater <script>","assets":[{"name":"package.zip","size":123}]}`
	var release Release
	if err := json.Unmarshal([]byte(payload), &release); err != nil {
		t.Fatal(err)
	}
	check := CheckResult{Latest: &release, Update: true}
	status := UpdateStatus{ID: "notes-op", Stage: "ready", Running: true, Check: &check}
	data, err := json.Marshal(status)
	if err != nil {
		t.Fatal(err)
	}
	var restored UpdateStatus
	if err := json.Unmarshal(data, &restored); err != nil {
		t.Fatal(err)
	}
	if restored.Check == nil || restored.Check.Latest == nil || restored.Check.Latest.Body != release.Body || !strings.Contains(release.Body, "## Changes\n") {
		t.Fatalf("release notes lost in update status: %s", data)
	}
	if restored.Check.Latest.TagName != "v1.2.3" || len(restored.Check.Latest.Assets) != 1 {
		t.Fatalf("release metadata changed: %s", data)
	}
}
