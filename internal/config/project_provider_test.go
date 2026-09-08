package config

import "testing"

func TestDefaultProjectProviderPersistence(t *testing.T) {
	for _, provider := range []string{"", "official", "admin"} {
		t.Run("provider_"+provider, func(t *testing.T) {
			root := t.TempDir()
			cfg := Default()
			cfg.DefaultProjectProvider = provider
			if err := NewStore(root).Save(cfg); err != nil {
				t.Fatal(err)
			}
			if got := NewStore(root).Snapshot().DefaultProjectProvider; got != provider {
				t.Fatalf("got %q want %q", got, provider)
			}
		})
	}
}

func TestDefaultProjectProviderRejectsInvalid(t *testing.T) {
	cfg := Default()
	cfg.DefaultProjectProvider = "unknown"
	if err := NewStore(t.TempDir()).Save(cfg); err == nil {
		t.Fatal("invalid provider accepted")
	}
}
