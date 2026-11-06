package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func call(t *testing.T, s *Server, method, path string, body any) (int, map[string]any) {
	t.Helper()
	b, _ := json.Marshal(body)
	q := httptest.NewRequest(method, path, bytes.NewReader(b))
	w := httptest.NewRecorder()
	s.ServeHTTP(w, q)
	v := map[string]any{}
	json.Unmarshal(w.Body.Bytes(), &v)
	return w.Code, v
}
func create(t *testing.T, s *Server) (string, string, string) {
	t.Helper()
	status, v := call(t, s, "POST", "/api/rooms", map[string]string{"name": "Test " + strconv.Itoa(len(s.rooms)), "player": "Ada"})
	if status != 201 {
		t.Fatalf("create: %d %v", status, v)
	}
	return v["room"].(map[string]any)["id"].(string), v["token"].(string), v["player"].(string)
}
func TestCapacityAndExpiry(t *testing.T) {
	s := newServer()
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	for i := 0; i < maxRooms; i++ {
		create(t, s)
	}
	status, _ := call(t, s, "POST", "/api/rooms", map[string]string{"name": "11", "player": "a"})
	if status != 409 {
		t.Fatal(status)
	}
	now = now.Add(idleTTL)
	s.clean()
	if len(s.rooms) != 0 {
		t.Fatal("idle rooms not removed")
	}
	rid, _, _ := create(t, s)
	now = now.Add(roomTTL)
	s.rooms[rid].Active = now
	s.clean()
	if len(s.rooms) != 0 {
		t.Fatal("hard expiration ignored")
	}
}
func TestMatchFlow(t *testing.T) {
	s := newServer()
	rid, host, hostID := create(t, s)
	path := "/api/rooms/" + rid + "/"
	status, v := call(t, s, "POST", path+"join", map[string]string{"name": "Bob"})
	if status != 200 {
		t.Fatal(status)
	}
	guest := v["token"].(string)
	guestID := v["player"].(string)
	action := func(kind, token string, extra map[string]any) int {
		if extra == nil {
			extra = map[string]any{}
		}
		extra["token"] = token
		if kind == "fire" {
			extra["seed"] = s.rooms[rid].Seed
		}
		status, _ := call(t, s, "POST", path+kind, extra)
		return status
	}
	if action("start", host, nil) != 409 {
		t.Fatal("started without teams")
	}
	for token, team := range map[string]string{host: "red", guest: "blue"} {
		if action("team", token, map[string]any{"team": team}) != 200 {
			t.Fatal("team")
		}
	}
	if action("start", guest, nil) != 403 {
		t.Fatal("non-host start")
	}
	if action("start", host, nil) != 200 {
		t.Fatal("start")
	}
	if s.rooms[rid].History == nil {
		t.Fatal("history must serialize as array")
	}
	first, second, firstID := host, guest, hostID
	if s.rooms[rid].Turn == "blue" {
		first, second, firstID = guest, host, guestID
	}
	shot := map[string]any{"text": "sin(x)", "shot": 0, "data": map[string]any{"hits": []string{}, "winner": ""}}
	if action("fire", second, shot) != 409 {
		t.Fatal("out of turn")
	}
	if action("fire", "bad", shot) != 401 {
		t.Fatal("unauthenticated")
	}
	if action("fire", first, shot) != 200 {
		t.Fatal("fire")
	}
	if action("fire", first, shot) != 409 {
		t.Fatal("duplicate shot")
	}
	if action("team", host, map[string]any{"team": "watch"}) != 409 {
		t.Fatal("team change during match")
	}
	if action("fire", second, map[string]any{"text": "0", "shot": 1, "data": map[string]any{"hits": []string{firstID}}}) != 200 {
		t.Fatal("winning fire")
	}
	if s.rooms[rid].Phase != "finished" {
		t.Fatal("not finished")
	}
	if len(s.rooms[rid].History) != 2 {
		t.Fatal("history")
	}
	before := s.rooms[rid].Active
	if action("chat", "bad", map[string]any{"text": "spam"}) != 401 {
		t.Fatal("chat auth")
	}
	if !before.Equal(s.rooms[rid].Active) {
		t.Fatal("invalid action extended expiry")
	}
	if action("leave", host, nil) != 200 || s.rooms[rid].Host != guestID {
		t.Fatal("host transfer")
	}
}
func TestBroadcastAndExpiryClose(t *testing.T) {
	s := newServer()
	rid, token, _ := create(t, s)
	r := s.rooms[rid]
	ch := make(chan []byte, 8)
	r.listeners[ch] = true
	status, _ := call(t, s, "POST", "/api/rooms/"+rid+"/chat", map[string]string{"token": token, "text": "hello"})
	if status != 200 {
		t.Fatal(status)
	}
	select {
	case msg := <-ch:
		if !bytes.Contains(msg, []byte("hello")) {
			t.Fatal("missing message")
		}
		if bytes.Contains(msg, []byte(token)) {
			t.Fatal("token leaked")
		}
	default:
		t.Fatal("missing broadcast")
	}
	s.now = func() time.Time { return r.Created.Add(roomTTL) }
	s.clean()
	if _, ok := <-ch; ok {
		t.Fatal("stream not closed")
	}
}
func TestHistoryBoundAndShotRetention(t *testing.T) {
	s := newServer()
	rid, token, _ := create(t, s)
	r := s.rooms[rid]
	r.History = append(r.History, Event{Kind: "fire", Text: "0"})
	for i := 0; i < 300; i++ {
		call(t, s, "POST", "/api/rooms/"+rid+"/chat", map[string]string{"token": token, "text": "hello"})
	}
	if len(r.History) > 256 || r.History[0].Kind != "fire" {
		t.Fatal("history not bounded or shot lost")
	}
}

// Cancel after the initial flush: exercises the stream without a network socket.
type streamRecorder struct {
	*httptest.ResponseRecorder
	cancel func()
}

func (w streamRecorder) Flush() { w.ResponseRecorder.Flush(); w.cancel() }
func TestEventStreamSnapshot(t *testing.T) {
	s := newServer()
	rid, token, _ := create(t, s)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	q := httptest.NewRequest("GET", "/api/rooms/"+rid+"/events?token="+token, nil).WithContext(ctx)
	w := streamRecorder{httptest.NewRecorder(), cancel}
	s.ServeHTTP(w, q)
	if w.Header().Get("Content-Type") != "text/event-stream" || !bytes.Contains(w.Body.Bytes(), []byte("data: ")) {
		t.Fatal("missing SSE snapshot")
	}
	if bytes.Contains(w.Body.Bytes(), []byte(token)) {
		t.Fatal("token leaked")
	}
	if len(s.rooms[rid].listeners) != 0 {
		t.Fatal("listener leaked")
	}
}

func TestSecurityHeadersAndOrigins(t *testing.T) {
	h := secure(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
	for _, tc := range []struct {
		method, origin, site, contentType string
		want                              int
	}{
		{"GET", "", "", "", 204},
		{"POST", "http://example.com", "same-origin", "application/json", 204},
		{"POST", "https://evil.example", "cross-site", "application/json", 403},
		{"POST", "https://evil.example", "", "application/json", 403},
		{"POST", "null", "", "application/json", 403},
		{"POST", "", "", "text/plain", 415},
		{"POST", "", "", "application/json; charset=utf-8", 204},
	} {
		q := httptest.NewRequest(tc.method, "http://example.com/api/rooms", nil)
		q.Header.Set("Origin", tc.origin)
		q.Header.Set("Sec-Fetch-Site", tc.site)
		q.Header.Set("Content-Type", tc.contentType)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, q)
		if w.Code != tc.want {
			t.Fatalf("%+v: got %d", tc, w.Code)
		}
		csp := w.Header().Get("Content-Security-Policy")
		if csp == "" || strings.Contains(csp, "unsafe-inline") || strings.Contains(csp, "unsafe-eval") {
			t.Fatal("weak CSP")
		}
		if w.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Fatal("missing nosniff")
		}
	}
}

func TestCreateOrJoin(t *testing.T) {
	s := newServer()
	status, first := call(t, s, "POST", "/api/rooms", map[string]string{"name": "  Friends  ", "player": "Ada"})
	if status != 201 {
		t.Fatal(status)
	}
	rid := first["room"].(map[string]any)["id"].(string)
	status, second := call(t, s, "POST", "/api/rooms", map[string]string{"name": "friends", "player": "Bob"})
	if status != 200 || second["room"].(map[string]any)["id"] != rid || len(s.rooms) != 1 {
		t.Fatal("did not join existing room")
	}
	for i := 1; i < maxRooms; i++ {
		create(t, s)
	}
	status, _ = call(t, s, "POST", "/api/rooms", map[string]string{"name": "FRIENDS", "player": "Carol"})
	if status != 200 {
		t.Fatal("existing room blocked at server capacity", status)
	}
	status, _ = call(t, s, "POST", "/api/rooms", map[string]string{"name": rid, "player": "Dave"})
	if status != 200 {
		t.Fatal("room code did not join", status)
	}
	for len(s.rooms[rid].Players) < 24 {
		call(t, s, "POST", "/api/rooms", map[string]string{"name": "friends", "player": "Guest"})
	}
	status, _ = call(t, s, "POST", "/api/rooms", map[string]string{"name": "friends", "player": "Extra"})
	if status != 409 || len(s.rooms) != maxRooms {
		t.Fatal("full room should not create a duplicate")
	}
}
func TestConcurrentCreateOrJoin(t *testing.T) {
	s := newServer()
	results := make(chan int, 2)
	for i := 0; i < 2; i++ {
		go func() {
			status, _ := call(t, s, "POST", "/api/rooms", map[string]string{"name": "Same room", "player": "Guest"})
			results <- status
		}()
	}
	a, b := <-results, <-results
	if !((a == 200 && b == 201) || (a == 201 && b == 200)) || len(s.rooms) != 1 {
		t.Fatal("concurrent requests created duplicates", a, b)
	}
}

func TestMultipleEnemyHitsAndNoFriendlyFire(t *testing.T) {
	s := newServer()
	rid, token, pid := create(t, s)
	r := s.rooms[rid]
	r.Players[0].Team = "red"
	r.Players = append(r.Players, Player{ID: "ally", Name: "Ally", Team: "red"}, Player{ID: "enemy1", Name: "First", Team: "blue"}, Player{ID: "enemy2", Name: "Second", Team: "blue"})
	r.Roster = append([]Player{}, r.Players...)
	r.Phase = "playing"
	r.Turn = "red"
	r.Seed = id()
	fire := func(hits []string) int {
		status, _ := call(t, s, "POST", "/api/rooms/"+rid+"/fire", map[string]any{"token": token, "seed": r.Seed, "shot": 0, "text": "0", "data": map[string]any{"hits": hits}})
		return status
	}
	for _, hits := range [][]string{{"ally"}, {pid}, {"enemy1", "enemy1"}, {"enemy1", "ally"}} {
		if fire(hits) != 400 || r.Shot != 0 || len(r.History) != 0 {
			t.Fatal("invalid target list accepted", hits)
		}
	}
	if fire([]string{"enemy1", "enemy2"}) != 200 || r.Phase != "finished" {
		t.Fatal("multiple enemy hits rejected")
	}
	var result struct {
		Hits   []string `json:"hits"`
		Winner string   `json:"winner"`
	}
	json.Unmarshal(r.History[0].Data, &result)
	if len(result.Hits) != 2 || result.Winner != "red" {
		t.Fatal("incorrect result", result)
	}
}

func TestRandomStartingSideAndRematch(t *testing.T) {
	for _, tc := range []struct{ seed, want string }{{"0000", "red"}, {"7fff", "red"}, {"8000", "blue"}, {"ffff", "blue"}} {
		if firstTeam(tc.seed) != tc.want {
			t.Fatal("wrong starting side", tc)
		}
	}
	s := newServer()
	rid, token, _ := create(t, s)
	r := s.rooms[rid]
	r.Players[0].Team = "red"
	r.Players = append(r.Players, Player{ID: "blue", Name: "Blue", Team: "blue"})
	for i := 0; i < 4; i++ {
		oldSeed := r.Seed
		r.Phase = "finished"
		r.Shot = 42
		status, _ := call(t, s, "POST", "/api/rooms/"+rid+"/start", map[string]string{"token": token})
		if status != 200 || r.FirstTurn != firstTeam(r.Seed) || r.Turn != r.FirstTurn || r.Seed == oldSeed || r.Shot != 0 {
			t.Fatal("start or rematch did not choose a fresh side", status)
		}
		firstToken := token
		otherToken := "other"
		r.tokens[otherToken] = "blue"
		if r.Turn == "blue" {
			firstToken, otherToken = otherToken, token
		}
		shot := map[string]any{"seed": r.Seed, "shot": 0, "text": "0", "data": map[string]any{"hits": []string{}}}
		shot["token"] = otherToken
		status, _ = call(t, s, "POST", "/api/rooms/"+rid+"/fire", shot)
		if status != 409 {
			t.Fatal("wrong team allowed first shot")
		}
		shot["token"] = firstToken
		status, _ = call(t, s, "POST", "/api/rooms/"+rid+"/fire", shot)
		if status != 200 || r.Turn == r.FirstTurn {
			t.Fatal("first team could not fire or turn did not alternate")
		}
	}
}
