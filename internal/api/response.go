package api

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

// writeCachedJSON is opt-in for read-only snapshots, never streaming responses.
// Validate the full payload, including live state, not just its timestamp.
func writeCachedJSON(w http.ResponseWriter, r *http.Request, v interface{}) {
	body, err := json.Marshal(v)
	if err != nil {
		bad(w, http.StatusInternalServerError, err.Error())
		return
	}
	compressed := len(body) >= 1024 && acceptsGzip(r.Header.Get("Accept-Encoding"))
	variant := ""
	if compressed {
		variant = "-gzip"
	}
	etag := fmt.Sprintf(`"%x%s"`, sha256.Sum256(body), variant)
	w.Header().Add("Vary", "Accept-Encoding")
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "private, no-cache")
	if ifNoneMatch(r.Header.Get("If-None-Match"), etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	if compressed {
		var buf bytes.Buffer
		zw, _ := gzip.NewWriterLevel(&buf, gzip.BestSpeed)
		_, _ = zw.Write(body)
		_ = zw.Close()
		body = buf.Bytes()
		w.Header().Set("Content-Encoding", "gzip")
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_, _ = w.Write(body)
}

// ifNoneMatch uses the weak comparison RFC 9110 requires for If-None-Match.
func ifNoneMatch(header, etag string) bool {
	for _, candidate := range strings.Split(header, ",") {
		candidate = strings.TrimSpace(candidate)
		if candidate == "*" || strings.TrimPrefix(candidate, "W/") == etag {
			return true
		}
	}
	return false
}

func bad(w http.ResponseWriter, code int, msg string) {
	if code == http.StatusBadRequest && msg == errRequestBodyTooLarge.Error() {
		code = http.StatusRequestEntityTooLarge
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"detail": msg})
}

const maxJSONBodyBytes = 1 << 20

var errRequestBodyTooLarge = errors.New("request body too large")

func decode(r *http.Request, v interface{}) (err error) {
	return decodeLimited(r, v, maxJSONBodyBytes)
}

// decodeLimited decodes a JSON request body enforcing a maximum size in bytes.
// It allows endpoints that accept large payloads (e.g. chat image uploads) to
// raise the limit above the default maxJSONBodyBytes.
func decodeLimited(r *http.Request, v interface{}, limit int64) (err error) {
	defer func() {
		if closeErr := r.Body.Close(); closeErr != nil && err == nil {
			err = closeErr
		}
	}()
	data, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
	if err != nil {
		return err
	}
	if int64(len(data)) > limit {
		return errRequestBodyTooLarge
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	if err := dec.Decode(v); err != nil {
		return err
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		if err == nil {
			return errors.New("request body must contain a single JSON value")
		}
		return err
	}
	return nil
}
