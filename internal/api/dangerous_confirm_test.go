package api

import (
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

func TestDangerousConfirmWrapperRejectsMissingHeader(t *testing.T) {
	h := newGoalTestServer(t, t.TempDir()).Routes()
	for _, tc := range dangerousConfirmRouteCases() {
		t.Run(tc.path, func(t *testing.T) {
			rr := httptest.NewRecorder()
			req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			h.ServeHTTP(rr, req)
			if rr.Code != http.StatusPreconditionRequired {
				t.Fatalf("%s %s status=%d want=%d body=%s", tc.method, tc.path, rr.Code, http.StatusPreconditionRequired, rr.Body.String())
			}
			if !strings.Contains(rr.Body.String(), "X-GA-Confirm") {
				t.Fatalf("%s %s missing confirm guidance in body: %s", tc.method, tc.path, rr.Body.String())
			}
		})
	}
}

func TestDangerousConfirmWrapperAllowsConfirmedRequestsToReachValidation(t *testing.T) {
	h := newGoalTestServer(t, t.TempDir()).Routes()
	for _, tc := range safeValidationDangerousConfirmRouteCases() {
		t.Run(tc.path, func(t *testing.T) {
			rr := httptest.NewRecorder()
			req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			markDangerous(req)
			h.ServeHTTP(rr, req)
			if rr.Code == http.StatusPreconditionRequired {
				t.Fatalf("%s %s confirmed request was still blocked by confirm wrapper: body=%s", tc.method, tc.path, rr.Body.String())
			}
			if rr.Code == http.StatusOK {
				t.Fatalf("%s %s validation payload unexpectedly succeeded; test should not perform side effects", tc.method, tc.path)
			}
		})
	}
}

func TestDangerousHeaderRoutesRejectMissingHeader(t *testing.T) {
	h := newGoalTestServer(t, t.TempDir()).Routes()
	for _, tc := range dangerousHeaderRouteCases() {
		t.Run(tc.path, func(t *testing.T) {
			rr := httptest.NewRecorder()
			req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			h.ServeHTTP(rr, req)
			if rr.Code != http.StatusPreconditionRequired {
				t.Fatalf("%s %s status=%d want=%d body=%s", tc.method, tc.path, rr.Code, http.StatusPreconditionRequired, rr.Body.String())
			}
			if !strings.Contains(rr.Body.String(), "X-GA-Confirm") {
				t.Fatalf("%s %s missing confirm guidance in body: %s", tc.method, tc.path, rr.Body.String())
			}
		})
	}
}

func TestDangerousHeaderRoutesAllowConfirmedRequestsToReachValidation(t *testing.T) {
	h := newGoalTestServer(t, t.TempDir()).Routes()
	for _, tc := range dangerousHeaderRouteCases() {
		t.Run(tc.path, func(t *testing.T) {
			rr := httptest.NewRecorder()
			req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			markDangerous(req)
			h.ServeHTTP(rr, req)
			if rr.Code == http.StatusPreconditionRequired {
				t.Fatalf("%s %s confirmed request was still blocked by dangerous header guard: body=%s", tc.method, tc.path, rr.Body.String())
			}
			if rr.Code == http.StatusOK {
				t.Fatalf("%s %s validation payload unexpectedly succeeded; test should not perform side effects", tc.method, tc.path)
			}
		})
	}
}

func TestDangerousConfirmCasesCoverRegisteredRoutes(t *testing.T) {
	apiSource, err := os.ReadFile("api.go")
	if err != nil {
		t.Fatal(err)
	}
	re := regexp.MustCompile(`mux\.HandleFunc\("([^"]+)",\s*s\.requireDangerousConfirm\(`)
	matches := re.FindAllSubmatch(apiSource, -1)
	if len(matches) < 20 {
		t.Fatalf("expected many dangerous-confirm routes in api.go, got %d", len(matches))
	}

	registered := make(map[string]bool, len(matches))
	for _, match := range matches {
		registered[string(match[1])] = true
	}
	cases := make(map[string]bool, len(dangerousConfirmRouteCases()))
	for _, tc := range dangerousConfirmRouteCases() {
		cases[tc.path] = true
	}

	var missingCases []string
	for route := range registered {
		if !cases[route] {
			missingCases = append(missingCases, route)
		}
	}
	var staleCases []string
	for route := range cases {
		if !registered[route] {
			staleCases = append(staleCases, route)
		}
	}
	sort.Strings(missingCases)
	sort.Strings(staleCases)
	if len(missingCases) > 0 || len(staleCases) > 0 {
		t.Fatalf("dangerous confirm cases drifted from api.go registered routes: missing=%v stale=%v", missingCases, staleCases)
	}
}

func TestRiskCatalogDangerousEntriesStayProtected(t *testing.T) {
	registered, err := registeredRoutesFromSource("api.go")
	if err != nil {
		t.Fatal(err)
	}
	routesByPath := map[string]registeredRoute{}
	for _, route := range registered {
		routesByPath[route.Path] = route
	}

	var unprotected []string
	for _, item := range riskCatalogItems {
		if item.Level != "dangerous" {
			continue
		}
		route, ok := routesByPath[item.Path]
		if !ok {
			unprotected = append(unprotected, item.Path+" is documented in riskCatalogItems but not registered")
			continue
		}
		if !route.DangerousConfirm && !route.DangerousHeader {
			unprotected = append(unprotected, item.Path+" is dangerous in riskCatalogItems but is not confirm/header protected")
		}
	}
	sort.Strings(unprotected)
	if len(unprotected) > 0 {
		t.Fatalf("dangerous risk catalog entries must stay behind an explicit safety gate: %v", unprotected)
	}
}

func TestProtectedRiskyRoutesHaveRiskCatalogEntries(t *testing.T) {
	registered, err := registeredRoutesFromSource("api.go")
	if err != nil {
		t.Fatal(err)
	}
	cataloged := map[string]bool{}
	for _, item := range riskCatalogItems {
		cataloged[item.Path] = true
	}

	var missing []string
	for _, route := range registered {
		if !route.DangerousConfirm && !route.DangerousHeader {
			continue
		}
		if route.Path == "/api/chat/" { // chat has a per-command dangerous guard, not a route-wide guard.
			continue
		}
		if strings.HasPrefix(route.Path, "/api/tmwebdriver/") {
			continue
		}
		if !cataloged[route.Path] {
			missing = append(missing, route.Path+" -> "+route.Handler)
		}
	}
	sort.Strings(missing)
	if len(missing) > 0 {
		t.Fatalf("protected risky routes need lightweight risk catalog metadata: %v", missing)
	}
}

func TestMutatingRoutesEitherRequireDangerousConfirmOrAreDocumentedSafe(t *testing.T) {
	registered, err := registeredRoutesFromSource("api.go")
	if err != nil {
		t.Fatal(err)
	}
	methodsByHandler, err := routeMethodsByHandlerFromSource(".")
	if err != nil {
		t.Fatal(err)
	}

	documentedSafe := map[string]bool{
		"/api/version/check":            true, // remote version metadata check only; no local writes.
		"/api/setup/browse":             true, // validates/list paths for setup UX; no persisted configuration.
		"/api/models/preview":           true, // renders preview text only; no writes.
		"/api/channels/test":            true, // calls provider validation endpoints only; no local config writes.
		"/api/chat/":                    true, // first-party chat CRUD/run endpoint; intentionally outside dangerous-confirm UX.
		"/api/chat/sidebar-preferences": true, // reversible Admin-only UI preference file; no GA runtime configuration writes.
	}

	var unreviewed []string
	for _, route := range registered {
		methods := methodsByHandler[route.Handler]
		if !hasMutatingMethod(methods) || route.DangerousConfirm || route.DangerousHeader || documentedSafe[route.Path] {
			continue
		}
		unreviewed = append(unreviewed, route.Path+" -> "+route.Handler)
	}
	sort.Strings(unreviewed)
	if len(unreviewed) > 0 {
		t.Fatalf("mutating routes must be requireDangerousConfirm-wrapped or explicitly documented safe: %v", unreviewed)
	}
}

func TestDocumentedSafeMutatingRoutesStayCurrent(t *testing.T) {
	documentedSafe := map[string]bool{
		"/api/version/check":            true,
		"/api/setup/browse":             true,
		"/api/models/preview":           true,
		"/api/channels/test":            true,
		"/api/chat/":                    true,
		"/api/chat/sidebar-preferences": true,
	}

	registered, err := registeredRoutesFromSource("api.go")
	if err != nil {
		t.Fatal(err)
	}
	methodsByHandler, err := routeMethodsByHandlerFromSource(".")
	if err != nil {
		t.Fatal(err)
	}
	mutating := map[string]bool{}
	for _, route := range registered {
		if hasMutatingMethod(methodsByHandler[route.Handler]) && !route.DangerousConfirm && !route.DangerousHeader {
			mutating[route.Path] = true
		}
	}
	for path := range documentedSafe {
		if path == "/api/chat/" { // Mixed route: only classified dangerous commands require confirmation.
			continue
		}
		if !mutating[path] {
			t.Fatalf("documented safe mutating route %s is stale or now protected; update route safety contract", path)
		}
	}
}

func TestLocalStateMutatingRoutesHaveReviewedSafetyGate(t *testing.T) {
	registered, err := registeredRoutesFromSource("api.go")
	if err != nil {
		t.Fatal(err)
	}
	methodsByHandler, err := routeMethodsByHandlerFromSource(".")
	if err != nil {
		t.Fatal(err)
	}
	sideEffectsByHandler, err := routeSideEffectsByHandlerFromSource(".")
	if err != nil {
		t.Fatal(err)
	}

	reviewedSafe := map[string]string{
		"/api/chat/":                    "first-party chat CRUD/run endpoint intentionally manages chat state outside dangerous-confirm UX",
		"/api/chat/sidebar-preferences": "reversible Admin-only UI preference file, independent of GA runtime configuration",
	}

	var unreviewed []string
	for _, route := range registered {
		if !hasMutatingMethod(methodsByHandler[route.Handler]) {
			continue
		}
		stateMutations := localStateMutationSideEffects(sideEffectsByHandler[route.Handler])
		if len(stateMutations) == 0 {
			continue
		}
		if route.DangerousConfirm || route.DangerousHeader {
			continue
		}
		if reviewedSafe[route.Path] != "" {
			continue
		}
		unreviewed = append(unreviewed, route.Path+" -> "+route.Handler+" reaches "+strings.Join(sortedMapKeys(stateMutations), ", "))
	}
	sort.Strings(unreviewed)
	if len(unreviewed) > 0 {
		t.Fatalf("local-state mutating routes must use dangerous confirm, dangerous header, or reviewed safe exception: %v", unreviewed)
	}
}

func TestReviewedSafeLocalStateMutatingRoutesStayCurrent(t *testing.T) {
	reviewedSafe := map[string]string{
		"/api/chat/":                    "first-party chat CRUD/run endpoint intentionally manages chat state outside dangerous-confirm UX",
		"/api/chat/sidebar-preferences": "reversible Admin-only UI preference file, independent of GA runtime configuration",
	}

	registered, err := registeredRoutesFromSource("api.go")
	if err != nil {
		t.Fatal(err)
	}
	methodsByHandler, err := routeMethodsByHandlerFromSource(".")
	if err != nil {
		t.Fatal(err)
	}
	sideEffectsByHandler, err := routeSideEffectsByHandlerFromSource(".")
	if err != nil {
		t.Fatal(err)
	}

	localStateMutating := map[string]bool{}
	for _, route := range registered {
		if hasMutatingMethod(methodsByHandler[route.Handler]) && len(localStateMutationSideEffects(sideEffectsByHandler[route.Handler])) > 0 && !route.DangerousConfirm && !route.DangerousHeader {
			localStateMutating[route.Path] = true
		}
	}
	for path := range reviewedSafe {
		if path == "/api/chat/" { // mixed route: safe chat operations remain allowed alongside guarded commands.
			continue
		}
		if !localStateMutating[path] {
			t.Fatalf("reviewed safe local-state mutating route %s is stale or now protected/no longer locally mutating; update route safety contract", path)
		}
	}
}

func TestRegisteredGetRoutesDoNotReachUnreviewedSideEffects(t *testing.T) {
	registered, err := registeredRoutesFromSource("api.go")
	if err != nil {
		t.Fatal(err)
	}
	methodsByHandler, err := routeMethodsByHandlerFromSource(".")
	if err != nil {
		t.Fatal(err)
	}
	sideEffectsByHandler, err := routeSideEffectsByHandlerForMethodFromSource(".", http.MethodGet)
	if err != nil {
		t.Fatal(err)
	}

	reviewedGetSideEffects := map[string]bool{
		"/api/chat/sessions":      true, // GET may run one-time chat data migration/dir initialization before listing sessions.
		"/api/chat/":              true, // GET session/state/stream/file paths share chat storage helpers that may migrate legacy data.
		"/api/usage/overview":     true, // First GET migrates legacy per-message usage into the independent ledger.
		"/api/setup/env":          true, // GET setup diagnostics intentionally run tool version probes (git/python/uv/npm).
		"/api/tmwebdriver/status": true, // GET TMWebDriver diagnostics intentionally run local process/python dependency probes.
		"/api/keychain":           true, // GET decrypts the local keychain to list names; it never writes or returns values.
	}

	var unreviewed []string
	for _, route := range registered {
		if !methodsByHandler[route.Handler][http.MethodGet] {
			continue
		}
		sideEffects := sideEffectsByHandler[route.Handler]
		if len(sideEffects) == 0 {
			continue
		}
		if reviewedGetSideEffects[route.Path] {
			continue
		}
		unreviewed = append(unreviewed, route.Path+" -> "+route.Handler+" reaches "+strings.Join(sortedMapKeys(sideEffects), ", "))
	}
	sort.Strings(unreviewed)
	if len(unreviewed) > 0 {
		t.Fatalf("GET routes must not reach unreviewed local side effects: %v", unreviewed)
	}
}

func TestReviewedGetSideEffectRoutesStayCurrent(t *testing.T) {
	registered, err := registeredRoutesFromSource("api.go")
	if err != nil {
		t.Fatal(err)
	}
	methodsByHandler, err := routeMethodsByHandlerFromSource(".")
	if err != nil {
		t.Fatal(err)
	}
	sideEffectsByHandler, err := routeSideEffectsByHandlerFromSource(".")
	if err != nil {
		t.Fatal(err)
	}

	routesByPath := map[string]registeredRoute{}
	for _, route := range registered {
		routesByPath[route.Path] = route
	}
	for _, routePath := range []string{"/api/chat/sessions", "/api/chat/", "/api/usage/overview", "/api/setup/env", "/api/tmwebdriver/status"} {
		route, ok := routesByPath[routePath]
		if !ok || !methodsByHandler[route.Handler][http.MethodGet] || len(sideEffectsByHandler[route.Handler]) == 0 {
			t.Fatalf("reviewed GET side-effect route %s is stale; update route safety contract", routePath)
		}
	}
}

func TestRouteSideEffectAuditIsMethodAware(t *testing.T) {
	dir := t.TempDir()
	source := `package api

import (
	"net/http"
	"os"
	"os/exec"
)

type Server struct{}
type worker struct{}

func (w *worker) start() {
	exec.Command("worker")
}

func (s *Server) postOnly(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		os.WriteFile("post.txt", nil, 0600)
	} else if r.Method == http.MethodGet {
		w.WriteHeader(http.StatusOK)
	}
}

func (s *Server) guardThenMutate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	os.Mkdir("put", 0700)
}

func (s *Server) switchByMethod(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodDelete:
		os.Remove("gone")
	case http.MethodGet:
		w.WriteHeader(http.StatusOK)
	}
}
`
	if err := os.WriteFile(filepath.Join(dir, "synthetic.go"), []byte(source), 0600); err != nil {
		t.Fatal(err)
	}

	getEffects, err := routeSideEffectsByHandlerForMethodFromSource(dir, http.MethodGet)
	if err != nil {
		t.Fatal(err)
	}
	for _, handler := range []string{"postOnly", "guardThenMutate", "switchByMethod"} {
		if effects := getEffects[handler]; len(effects) != 0 {
			t.Fatalf("GET audit for %s found side effects: %v", handler, sortedMapKeys(effects))
		}
	}

	postEffects, err := routeSideEffectsByHandlerForMethodFromSource(dir, http.MethodPost)
	if err != nil {
		t.Fatal(err)
	}
	if !postEffects["postOnly"]["os.WriteFile"] {
		t.Fatalf("POST audit missed postOnly os.WriteFile: %v", postEffects["postOnly"])
	}

	putEffects, err := routeSideEffectsByHandlerForMethodFromSource(dir, http.MethodPut)
	if err != nil {
		t.Fatal(err)
	}
	if !putEffects["guardThenMutate"]["os.Mkdir"] {
		t.Fatalf("PUT audit missed guardThenMutate os.Mkdir: %v", putEffects["guardThenMutate"])
	}

	deleteEffects, err := routeSideEffectsByHandlerForMethodFromSource(dir, http.MethodDelete)
	if err != nil {
		t.Fatal(err)
	}
	if !deleteEffects["switchByMethod"]["os.Remove"] {
		t.Fatalf("DELETE audit missed switchByMethod os.Remove: %v", deleteEffects["switchByMethod"])
	}
}

func TestRiskCatalogEndpointReturnsAuditableItems(t *testing.T) {
	h := newGoalTestServer(t, t.TempDir()).Routes()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/risk/catalog", nil)
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("risk catalog status=%d want=200 body=%s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Items []riskCatalogItem `json:"items"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("risk catalog response is not JSON: %v body=%s", err, rr.Body.String())
	}
	if len(resp.Items) != len(riskCatalogItems) {
		t.Fatalf("risk catalog returned %d items want %d", len(resp.Items), len(riskCatalogItems))
	}
	paths := make(map[string]bool, len(resp.Items))
	for _, item := range resp.Items {
		paths[item.Path] = true
	}
	for _, path := range []string{"/api/files/write", "/api/models", "/api/models/raw", "/api/models/import-mykey"} {
		if !paths[path] {
			t.Fatalf("risk catalog response missing %s", path)
		}
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/risk/catalog", strings.NewReader(`{}`))
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("risk catalog POST status=%d want=405 body=%s", rr.Code, rr.Body.String())
	}
}

func TestRiskCatalogCoversDangerousConfirmRoutes(t *testing.T) {
	catalogPaths := make(map[string]riskCatalogItem, len(riskCatalogItems))
	for _, item := range riskCatalogItems {
		if item.Path == "" || item.Level == "" || item.Action == "" || item.Reason == "" {
			t.Fatalf("risk catalog item must include path, level, action, and reason: %+v", item)
		}
		if _, exists := catalogPaths[item.Path]; exists {
			t.Fatalf("duplicate risk catalog path %q", item.Path)
		}
		catalogPaths[item.Path] = item
	}

	for _, tc := range dangerousConfirmRouteCases() {
		if _, ok := catalogPaths[tc.path]; !ok {
			t.Fatalf("dangerous confirm route %s %s missing from risk catalog", tc.method, tc.path)
		}
	}

	registered, err := registeredRoutesFromSource("api.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, route := range registered {
		if !route.DangerousHeader {
			continue
		}
		if route.Path == "/api/chat/" { // Catalog is command-specific; the route is not uniformly dangerous.
			continue
		}
		if _, ok := catalogPaths[route.Path]; !ok {
			t.Fatalf("dangerous header route %s missing from risk catalog", route.Path)
		}
	}
}

type dangerousConfirmRouteCase struct {
	method string
	path   string
	body   string
}

type registeredRoute struct {
	Path             string
	Handler          string
	DangerousConfirm bool
	DangerousHeader  bool
}

func registeredRoutesFromSource(apiPath string) ([]registeredRoute, error) {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, apiPath, nil, 0)
	if err != nil {
		return nil, err
	}
	headerHandlers, err := dangerousHeaderHandlersFromSource(filepath.Dir(apiPath))
	if err != nil {
		return nil, err
	}

	var routes []registeredRoute
	ast.Inspect(file, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok || len(call.Args) != 2 {
			return true
		}
		selector, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || selector.Sel.Name != "HandleFunc" {
			return true
		}
		pathLit, ok := call.Args[0].(*ast.BasicLit)
		if !ok {
			return true
		}
		routePath := strings.Trim(pathLit.Value, "`")
		routePath = strings.Trim(routePath, "\"")
		handler := handlerNameFromExpr(call.Args[1])
		if handler == "" {
			return true
		}
		routes = append(routes, registeredRoute{
			Path:             routePath,
			Handler:          handler,
			DangerousConfirm: exprCallsServerMethod(call.Args[1], "requireDangerousConfirm"),
			DangerousHeader:  headerHandlers[handler],
		})
		return true
	})
	return routes, nil
}

func routeMethodsByHandlerFromSource(dir string) (map[string]map[string]bool, error) {
	methods := map[string]map[string]bool{}
	calls := map[string]map[string]bool{}
	files, err := filepath.Glob(filepath.Join(dir, "*.go"))
	if err != nil {
		return nil, err
	}
	for _, name := range files {
		if strings.HasSuffix(name, "_test.go") {
			continue
		}
		fset := token.NewFileSet()
		file, err := parser.ParseFile(fset, name, nil, 0)
		if err != nil {
			return nil, err
		}
		for _, decl := range file.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Recv == nil || fn.Body == nil {
				continue
			}
			found := map[string]bool{}
			called := map[string]bool{}
			ast.Inspect(fn.Body, func(n ast.Node) bool {
				if name, ok := httpMethodName(n); ok {
					found[name] = true
				}
				if name, ok := serverMethodCallName(n); ok {
					called[name] = true
				}
				return true
			})
			if len(found) > 0 {
				methods[fn.Name.Name] = found
			}
			if len(called) > 0 {
				calls[fn.Name.Name] = called
			}
		}
	}
	propagateMethodsFromCalls(methods, calls)
	return methods, nil
}

func routeSideEffectsByHandlerFromSource(dir string) (map[string]map[string]bool, error) {
	return routeSideEffectsByHandlerForMethodFromSource(dir, "")
}

func routeSideEffectsByHandlerForMethodFromSource(dir string, method string) (map[string]map[string]bool, error) {
	sideEffects := map[string]map[string]bool{}
	calls := map[string]map[string]bool{}
	files, err := filepath.Glob(filepath.Join(dir, "*.go"))
	if err != nil {
		return nil, err
	}
	for _, name := range files {
		if strings.HasSuffix(name, "_test.go") {
			continue
		}
		fset := token.NewFileSet()
		file, err := parser.ParseFile(fset, name, nil, 0)
		if err != nil {
			return nil, err
		}
		for _, decl := range file.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Body == nil || !isServerMethodOrPackageFunction(fn) {
				continue
			}
			found := map[string]bool{}
			called := map[string]bool{}
			if method == "" {
				collectSideEffectsAndCalls(fn.Body, found, called)
			} else {
				collectSideEffectsAndCallsForMethod(fn.Body.List, method, found, called)
			}
			if len(found) > 0 {
				sideEffects[fn.Name.Name] = found
			}
			if len(called) > 0 {
				calls[fn.Name.Name] = called
			}
		}
	}
	propagateStringSetFromCalls(sideEffects, calls)
	return sideEffects, nil
}

func isServerMethodOrPackageFunction(fn *ast.FuncDecl) bool {
	if fn.Recv == nil {
		return true
	}
	for _, field := range fn.Recv.List {
		receiver := field.Type
		if pointer, ok := receiver.(*ast.StarExpr); ok {
			receiver = pointer.X
		}
		if ident, ok := receiver.(*ast.Ident); ok && ident.Name == "Server" {
			return true
		}
	}
	return false
}

func collectSideEffectsAndCalls(n ast.Node, found map[string]bool, called map[string]bool) {
	ast.Inspect(n, func(n ast.Node) bool {
		if effect, ok := localSideEffectCall(n); ok {
			found[effect] = true
		}
		if name, ok := packageOrServerCallName(n); ok {
			called[name] = true
		}
		return true
	})
}

func collectSideEffectsAndCallsForMethod(stmts []ast.Stmt, method string, found map[string]bool, called map[string]bool) {
	for i := 0; i < len(stmts); i++ {
		stmt := stmts[i]
		switch v := stmt.(type) {
		case *ast.SwitchStmt:
			if !isRequestMethodExpr(v.Tag) {
				collectSideEffectsAndCalls(v, found, called)
				continue
			}
			for _, item := range v.Body.List {
				cc := item.(*ast.CaseClause)
				if caseClauseMatchesMethod(cc, method) {
					collectSideEffectsAndCalls(cc, found, called)
				}
			}
		case *ast.IfStmt:
			if guardedMethod, ok := methodGuardReturns(v); ok {
				if guardedMethod == method {
					if v.Else != nil {
						collectSideEffectsAndCalls(v.Else, found, called)
					}
					continue
				}
				collectSideEffectsAndCalls(v.Body, found, called)
				return
			}
			if condMethod, ok := methodEquality(v.Cond); ok {
				if condMethod == method {
					collectSideEffectsAndCalls(v.Body, found, called)
				} else if v.Else != nil {
					collectSideEffectsAndCalls(v.Else, found, called)
				}
				continue
			}
			collectSideEffectsAndCalls(v, found, called)
		default:
			collectSideEffectsAndCalls(stmt, found, called)
		}
	}
}

func methodGuardReturns(stmt *ast.IfStmt) (string, bool) {
	method, ok := methodInequality(stmt.Cond)
	if !ok || !blockAlwaysReturns(stmt.Body) {
		return "", false
	}
	return method, true
}

func blockAlwaysReturns(block *ast.BlockStmt) bool {
	if block == nil || len(block.List) == 0 {
		return false
	}
	_, ok := block.List[len(block.List)-1].(*ast.ReturnStmt)
	return ok
}

func caseClauseMatchesMethod(cc *ast.CaseClause, method string) bool {
	if len(cc.List) == 0 {
		return true
	}
	for _, expr := range cc.List {
		if m, ok := httpMethodName(expr); ok && m == method {
			return true
		}
	}
	return false
}

func isRequestMethodExpr(expr ast.Expr) bool {
	sel, ok := expr.(*ast.SelectorExpr)
	if !ok || sel.Sel.Name != "Method" {
		return false
	}
	_, ok = sel.X.(*ast.Ident)
	return ok
}

func methodEquality(expr ast.Expr) (string, bool) {
	return methodBinaryExpr(expr, token.EQL)
}

func methodInequality(expr ast.Expr) (string, bool) {
	return methodBinaryExpr(expr, token.NEQ)
}

func methodBinaryExpr(expr ast.Expr, op token.Token) (string, bool) {
	b, ok := expr.(*ast.BinaryExpr)
	if !ok || b.Op != op {
		return "", false
	}
	if isRequestMethodExpr(b.X) {
		return httpMethodName(b.Y)
	}
	if isRequestMethodExpr(b.Y) {
		return httpMethodName(b.X)
	}
	return "", false
}

func propagateMethodsFromCalls(methods map[string]map[string]bool, calls map[string]map[string]bool) {
	changed := true
	for changed {
		changed = false
		for caller, callees := range calls {
			for callee := range callees {
				for method := range methods[callee] {
					if methods[caller] == nil {
						methods[caller] = map[string]bool{}
					}
					if !methods[caller][method] {
						methods[caller][method] = true
						changed = true
					}
				}
			}
		}
	}
}

func propagateStringSetFromCalls(values map[string]map[string]bool, calls map[string]map[string]bool) {
	changed := true
	for changed {
		changed = false
		for caller, callees := range calls {
			for callee := range callees {
				for value := range values[callee] {
					if values[caller] == nil {
						values[caller] = map[string]bool{}
					}
					if !values[caller][value] {
						values[caller][value] = true
						changed = true
					}
				}
			}
		}
	}
}

func packageOrServerCallName(n ast.Node) (string, bool) {
	call, ok := n.(*ast.CallExpr)
	if !ok {
		return "", false
	}
	switch fun := call.Fun.(type) {
	case *ast.Ident:
		return fun.Name, true
	case *ast.SelectorExpr:
		if ident, ok := fun.X.(*ast.Ident); ok && ident.Name == "s" {
			return fun.Sel.Name, true
		}
	}
	return "", false
}

func localSideEffectCall(n ast.Node) (string, bool) {
	call, ok := n.(*ast.CallExpr)
	if !ok {
		return "", false
	}
	switch fun := call.Fun.(type) {
	case *ast.Ident:
		if localSideEffectFuncName(fun.Name) {
			return fun.Name, true
		}
	case *ast.SelectorExpr:
		ident, ok := fun.X.(*ast.Ident)
		if !ok {
			return "", false
		}
		switch ident.Name {
		case "os":
			switch fun.Sel.Name {
			case "WriteFile", "Create", "CreateTemp", "Mkdir", "MkdirAll", "Remove", "RemoveAll", "Rename", "Truncate":
				return "os." + fun.Sel.Name, true
			}
		case "ioutil":
			if fun.Sel.Name == "WriteFile" || fun.Sel.Name == "TempFile" || fun.Sel.Name == "TempDir" {
				return "ioutil." + fun.Sel.Name, true
			}
		case "exec":
			if fun.Sel.Name == "Command" || fun.Sel.Name == "CommandContext" {
				return "exec." + fun.Sel.Name, true
			}
		}
	}
	return "", false
}

func localStateMutationSideEffects(sideEffects map[string]bool) map[string]bool {
	mutations := map[string]bool{}
	for name := range sideEffects {
		if strings.HasPrefix(name, "exec.") {
			continue
		}
		mutations[name] = true
	}
	return mutations
}

func localSideEffectFuncName(name string) bool {
	if name == "writeJSON" || name == "writeErrorJSON" {
		return false
	}
	lower := strings.ToLower(name)
	if strings.Contains(lower, "fileatomic") || strings.Contains(lower, "writefile") {
		return true
	}
	for _, prefix := range []string{"save", "delete", "remove", "create", "mkdir", "ensure", "install", "start", "stop", "export", "import"} {
		if strings.HasPrefix(lower, prefix) {
			return true
		}
	}
	return false
}

func sortedMapKeys(m map[string]bool) []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func dangerousHeaderHandlersFromSource(dir string) (map[string]bool, error) {
	handlers := map[string]bool{}
	calls := map[string]map[string]bool{}
	files, err := filepath.Glob(filepath.Join(dir, "*.go"))
	if err != nil {
		return nil, err
	}
	for _, name := range files {
		if strings.HasSuffix(name, "_test.go") {
			continue
		}
		fset := token.NewFileSet()
		file, err := parser.ParseFile(fset, name, nil, 0)
		if err != nil {
			return nil, err
		}
		for _, decl := range file.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Recv == nil || fn.Body == nil {
				continue
			}
			if exprCallsServerMethod(fn.Body, "requireDangerousHeader") {
				handlers[fn.Name.Name] = true
			}
			called := map[string]bool{}
			ast.Inspect(fn.Body, func(n ast.Node) bool {
				if name, ok := serverMethodCallName(n); ok {
					called[name] = true
				}
				return true
			})
			if len(called) > 0 {
				calls[fn.Name.Name] = called
			}
		}
	}
	propagateHandlerFlagsFromCalls(handlers, calls)
	return handlers, nil
}

func propagateHandlerFlagsFromCalls(handlers map[string]bool, calls map[string]map[string]bool) {
	changed := true
	for changed {
		changed = false
		for caller, callees := range calls {
			if handlers[caller] {
				continue
			}
			for callee := range callees {
				if handlers[callee] {
					handlers[caller] = true
					changed = true
					break
				}
			}
		}
	}
}

func serverMethodCallName(n ast.Node) (string, bool) {
	call, ok := n.(*ast.CallExpr)
	if !ok {
		return "", false
	}
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return "", false
	}
	if _, ok := sel.X.(*ast.Ident); !ok {
		return "", false
	}
	return sel.Sel.Name, true
}

func handlerNameFromExpr(expr ast.Expr) string {
	switch v := expr.(type) {
	case *ast.SelectorExpr:
		return v.Sel.Name
	case *ast.CallExpr:
		if len(v.Args) == 0 {
			return ""
		}
		return handlerNameFromExpr(v.Args[len(v.Args)-1])
	}
	return ""
}

func exprCallsServerMethod(expr ast.Node, method string) bool {
	found := false
	ast.Inspect(expr, func(n ast.Node) bool {
		switch v := n.(type) {
		case *ast.SelectorExpr:
			if v.Sel.Name == method {
				found = true
				return false
			}
		case *ast.Ident:
			if v.Name == method {
				found = true
				return false
			}
		}
		return true
	})
	return found
}

func httpMethodName(n ast.Node) (string, bool) {
	switch v := n.(type) {
	case *ast.SelectorExpr:
		if ident, ok := v.X.(*ast.Ident); ok && ident.Name == "http" && strings.HasPrefix(v.Sel.Name, "Method") {
			return strings.ToUpper(strings.TrimPrefix(v.Sel.Name, "Method")), true
		}
	case *ast.BasicLit:
		if v.Kind == token.STRING {
			method := strings.Trim(v.Value, "`")
			method = strings.Trim(method, "\"")
			switch method {
			case http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
				return method, true
			}
		}
	}
	return "", false
}

func hasMutatingMethod(methods map[string]bool) bool {
	return methods[http.MethodPost] || methods[http.MethodPut] || methods[http.MethodPatch] || methods[http.MethodDelete]
}

func dangerousConfirmRouteCases() []dangerousConfirmRouteCase {
	return []dangerousConfirmRouteCase{
		{http.MethodPost, "/api/version/update", `{}`},
		{http.MethodPost, "/api/version/restart", `{}`},
		{http.MethodPost, "/api/ga/git-mirror", `{}`},
		{http.MethodPost, "/api/tmwebdriver/repair", `{}`},
		{http.MethodPost, "/api/tmwebdriver/install-deps", `{}`},
		{http.MethodPost, "/api/files/write", `{}`},
		{http.MethodPost, "/api/files/delete", `{}`},
		{http.MethodPost, "/api/files/open", `{}`},
		{http.MethodPost, "/api/schedule/task", `{}`},
		{http.MethodPut, "/api/schedule/task", `{"id":"task","task":{}}`},
		{http.MethodPost, "/api/schedule/create", `{}`},
		{http.MethodPost, "/api/schedule/delete", `{}`},
		{http.MethodPost, "/api/schedule/toggle", `{}`},
		{http.MethodPost, "/api/goals/start", `{}`},
		{http.MethodPost, "/api/goals/stop", `{}`},
		{http.MethodPost, "/api/goals/delete", `{}`},
		{http.MethodPut, "/api/config", `not-json`},
		{http.MethodPost, "/api/instances/install", `{}`},
		{http.MethodPost, "/api/instances/create", `{}`},
		{http.MethodPost, "/api/instances/update", `{}`},
		{http.MethodPost, "/api/instances/delete", `{}`},
		{http.MethodPost, "/api/instances/default", `{}`},
		{http.MethodPost, "/api/setup/validate", `{}`},
		{http.MethodPost, "/api/setup/complete", `{}`},
		{http.MethodPost, "/api/setup/install", `{}`},
		{http.MethodPost, "/api/setup/python/install", `{}`},
		{http.MethodPost, "/api/setup/python/validate", `{}`},
		{http.MethodPost, "/api/setup/venv/create", `{}`},
		{http.MethodPost, "/api/setup/deps/install", `{}`},
		{http.MethodPost, "/api/setup/smoke", `{}`},
		{http.MethodPost, "/api/autostart/enable", `{}`},
		{http.MethodPost, "/api/autostart/disable", `{}`},
		{http.MethodPost, "/api/services/start", `{}`},
		{http.MethodPost, "/api/services/stop", `{}`},
		{http.MethodPost, "/api/services/stop-all", `{}`},
		{http.MethodPost, "/api/ga/processes/kill", `{}`},
		{http.MethodPost, "/api/ga/processes/adopt", `{}`},
		{http.MethodPost, "/api/services/autostart", `{}`},
		{http.MethodPost, "/api/services/model", `{}`},
		{http.MethodPost, "/api/models/export", `{}`},
		{http.MethodPut, "/api/models/title-model", `{"invalid_payload":true}`},
		{http.MethodPut, "/api/models/view-image-model", `{"invalid_payload":true}`},
		{http.MethodPut, "/api/channels", `{}`},
		{http.MethodPut, "/api/keychain", `{}`},
		{http.MethodPut, "/api/extra-system-prompt-presets", `{}`},
		{http.MethodPost, "/api/chat/python/install-deps", `{}`},
	}
}

func dangerousHeaderRouteCases() []dangerousConfirmRouteCase {
	return []dangerousConfirmRouteCase{
		{http.MethodPost, "/api/models/import-mykey", `{"reveal":false,"save":true}`},
		{http.MethodPut, "/api/ui/theme", `{"theme":"not-a-theme"}`},
	}
}

func safeValidationDangerousConfirmRouteCases() []dangerousConfirmRouteCase {
	return []dangerousConfirmRouteCase{
		{http.MethodPost, "/api/files/write", `{}`},
		{http.MethodPost, "/api/schedule/delete", `{}`},
		{http.MethodPost, "/api/schedule/toggle", `{}`},
		{http.MethodPost, "/api/goals/start", `{}`},
		{http.MethodPost, "/api/goals/stop", `{}`},
		{http.MethodPost, "/api/version/restart", `{}`},
		{http.MethodPost, "/api/goals/delete", `{}`},
		{http.MethodPut, "/api/config", `not-json`},
		{http.MethodPost, "/api/setup/validate", `{}`},
		// Keep this list limited to handlers that reject the test payload before
		// performing side effects. Installation/setup action endpoints are covered
		// by dangerousConfirmRouteCases above but are intentionally excluded here.
	}
}
