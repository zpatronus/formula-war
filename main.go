package main

import (
	"crypto/rand"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

//go:embed web/index.html web/style.css web/app.mjs web/game.mjs web/ui.mjs
var assets embed.FS

const idleTTL = 10 * time.Minute
const roomTTL = 2 * time.Hour
const maxRooms = 100

type Player struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Team string `json:"team"`
}
type Event struct {
	Kind   string          `json:"kind"`
	Player string          `json:"player"`
	Text   string          `json:"text,omitempty"`
	Data   json.RawMessage `json:"data,omitempty"`
	At     time.Time       `json:"at"`
}
type Room struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Host      string    `json:"host"`
	Created   time.Time `json:"created"`
	Active    time.Time `json:"active"`
	Players   []Player  `json:"players"`
	Roster    []Player  `json:"roster"`
	History   []Event   `json:"history"`
	Phase     string    `json:"phase"`
	Turn      string    `json:"turn"`
	FirstTurn string    `json:"firstTurn"`
	Seed      string    `json:"seed"`
	Shot      int       `json:"shot"`
	tokens    map[string]string
	listeners map[chan []byte]bool
}
type Server struct {
	mu    sync.Mutex
	rooms map[string]*Room
	now   func() time.Time
}

func newServer() *Server { return &Server{rooms: map[string]*Room{}, now: time.Now} }

// The first hexadecimal digit of a crypto-random seed is uniform over 0..f.
func firstTeam(seed string) string {
	if seed[0] < '8' {
		return "red"
	}
	return "blue"
}
func id() string {
	b := make([]byte, 16)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return hex.EncodeToString(b)
}
func (s *Server) clean() {
	now := s.now()
	for k, r := range s.rooms {
		if now.Sub(r.Active) >= idleTTL || now.Sub(r.Created) >= roomTTL {
			for ch := range r.listeners {
				close(ch)
			}
			delete(s.rooms, k)
		}
	}
}
func (s *Server) broadcast(r *Room) {
	b, _ := json.Marshal(r)
	for ch := range r.listeners {
		select {
		case ch <- b:
		default:
			close(ch)
			delete(r.listeners, ch)
		}
	}
}
func respond(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int, msg string) {
	respond(w, status, map[string]string{"error": msg})
}

// Keep user content inert even if a future UI change misses escaping.
func secure(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		if strings.HasPrefix(r.URL.Path, "/api/") {
			if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
				fail(w, 403, "Cross-site requests are not allowed")
				return
			}
			if origin := r.Header.Get("Origin"); origin != "" {
				u, err := url.Parse(origin)
				if err != nil || (u.Scheme != "http" && u.Scheme != "https") || !strings.EqualFold(u.Host, r.Host) || u.User != nil {
					fail(w, 403, "Origin is not allowed")
					return
				}
			}
			if r.Method == "POST" {
				contentType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
				if err != nil || contentType != "application/json" {
					fail(w, 415, "Use application/json")
					return
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}
func (s *Server) ServeHTTP(w http.ResponseWriter, q *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if q.URL.Path == "/api/rooms" {
		s.collection(w, q)
		return
	}
	p := strings.Split(strings.Trim(q.URL.Path, "/"), "/")
	if len(p) != 4 || p[0] != "api" || p[1] != "rooms" {
		http.NotFound(w, q)
		return
	}
	if p[3] == "events" {
		s.events(w, q, p[2])
		return
	}
	if q.Method != "POST" {
		fail(w, 405, "Use POST")
		return
	}
	var in struct {
		Token string          `json:"token"`
		Name  string          `json:"name"`
		Team  string          `json:"team"`
		Text  string          `json:"text"`
		Shot  int             `json:"shot"`
		Seed  string          `json:"seed"`
		Data  json.RawMessage `json:"data"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, q.Body, 16384)).Decode(&in); err != nil {
		fail(w, 400, "Invalid request")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.clean()
	r := s.rooms[p[2]]
	if r == nil {
		fail(w, 404, "Room expired or does not exist")
		return
	}
	if p[3] == "join" {
		s.joinRoom(w, r, in.Name)
		return
	}

	pid := r.tokens[in.Token]
	idx := -1
	for i, p := range r.Players {
		if p.ID == pid {
			idx = i
		}
	}
	if idx < 0 {
		fail(w, 401, "Join the room again")
		return
	}
	player := r.Players[idx]
	switch p[3] {
	case "team":
		if r.Phase == "playing" {
			fail(w, 409, "Wait until the match ends")
			return
		}
		if in.Team != "red" && in.Team != "blue" && in.Team != "watch" {
			fail(w, 400, "Invalid team")
			return
		}
		n := 0
		for _, p := range r.Players {
			if p.Team == in.Team && p.ID != pid {
				n++
			}
		}
		if in.Team != "watch" && n >= 4 {
			fail(w, 409, "Team is full")
			return
		}
		r.Players[idx].Team = in.Team
	case "start":
		if pid != r.Host {
			fail(w, 403, "Only the host can start")
			return
		}
		if r.Phase == "playing" {
			fail(w, 409, "Match already started")
			return
		}
		red, blue := false, false
		for _, p := range r.Players {
			red = red || p.Team == "red"
			blue = blue || p.Team == "blue"
		}
		if !red || !blue {
			fail(w, 409, "Both teams need a player")
			return
		}
		r.Phase = "playing"
		r.Seed = id()
		r.FirstTurn = firstTeam(r.Seed)
		r.Turn = r.FirstTurn
		r.Shot = 0
		r.History = []Event{}
		r.Roster = append([]Player{}, r.Players...)
	case "fire":
		if r.Phase != "playing" || player.Team != r.Turn {
			fail(w, 409, "It is not your team's turn")
			return
		}
		if in.Shot != r.Shot || in.Seed != r.Seed {
			fail(w, 409, "The turn has changed")
			return
		}
		alive := map[string]bool{}
		for _, p := range r.Roster {
			alive[p.ID] = true
		}
		for _, e := range r.History {
			if e.Kind == "fire" {
				var d struct {
					Hits []string `json:"hits"`
				}
				json.Unmarshal(e.Data, &d)
				for _, id := range d.Hits {
					delete(alive, id)
				}
			}
		}
		shooters := []Player{}
		for _, p := range r.Roster {
			if p.Team == r.Turn && alive[p.ID] {
				shooters = append(shooters, p)
			}
		}
		if len(shooters) == 0 || shooters[(r.Shot/2)%len(shooters)].ID != pid {
			fail(w, 409, "It is another player's turn")
			return
		}
		if len(in.Text) == 0 || len(in.Text) > 160 {
			fail(w, 400, "Equation must be 1–160 characters")
			return
		}
		// Physics is deliberately client-owned. Only accept bounded result identifiers.
		var result struct {
			Hits   []string `json:"hits"`
			Winner string   `json:"winner"`
		}
		if json.Unmarshal(in.Data, &result) != nil || len(result.Hits) > 8 || (result.Winner != "" && result.Winner != "red" && result.Winner != "blue" && result.Winner != "draw") {
			fail(w, 400, "Invalid shot result")
			return
		}
		for _, target := range result.Hits {
			if target == pid || !alive[target] {
				fail(w, 400, "Invalid hit target")
				return
			}
			found := false
			for _, p := range r.Roster {
				if p.ID == target && p.Team != "watch" && p.Team != player.Team {
					found = true
				}
			}
			if !found {
				fail(w, 400, "Invalid hit target")
				return
			}
			delete(alive, target)
		}
		redAlive, blueAlive := false, false
		for _, p := range r.Roster {
			if alive[p.ID] {
				redAlive = redAlive || p.Team == "red"
				blueAlive = blueAlive || p.Team == "blue"
			}
		}
		result.Winner = ""
		if !redAlive {
			result.Winner = "blue"
		}
		if !blueAlive {
			result.Winner = "red"
		}
		if (!redAlive && !blueAlive) || (r.Shot >= 99 && result.Winner == "") {
			result.Winner = "draw"
		}
		data, _ := json.Marshal(result)
		r.History = append(r.History, Event{"fire", pid, in.Text, data, s.now()})
		r.Shot++
		if r.Turn == "red" {
			r.Turn = "blue"
		} else {
			r.Turn = "red"
		}
		if result.Winner != "" {
			r.Phase = "finished"
		}
	case "chat":
		in.Text = strings.TrimSpace(in.Text)
		if len(in.Text) == 0 || len(in.Text) > 240 {
			fail(w, 400, "Message must be 1–240 characters")
			return
		}
		r.History = append(r.History, Event{"chat", pid, in.Text, nil, s.now()})
	case "leave":
		if r.Phase == "playing" && player.Team != "watch" {
			r.Phase = "finished"
		}
		r.Players = append(r.Players[:idx], r.Players[idx+1:]...)
		delete(r.tokens, in.Token)
		if pid == r.Host && len(r.Players) > 0 {
			r.Host = r.Players[0].ID
		}
	default:
		fail(w, 404, "Unknown action")
		return
	}
	if len(r.History) > 256 { // Never discard shot history needed to reconstruct a match.
		for i, e := range r.History {
			if e.Kind == "chat" {
				r.History = append(r.History[:i], r.History[i+1:]...)
				break
			}
		}
	}
	if r.Shot >= 100 && r.Phase == "playing" {
		r.Phase = "finished"
	}
	r.Active = s.now()
	s.broadcast(r)
	respond(w, 200, r)
}
func (s *Server) joinRoom(w http.ResponseWriter, r *Room, name string) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 24 {
		fail(w, 400, "Choose a name (1–24 characters)")
		return
	}
	if len(r.Players) >= 24 {
		fail(w, 409, "Room is full")
		return
	}
	token := id()
	player := Player{id(), name, "watch"}
	r.Players = append(r.Players, player)
	r.tokens[token] = player.ID
	r.Active = s.now()
	if len(r.Players) == 1 {
		r.Host = player.ID
	}
	s.broadcast(r)
	respond(w, 200, map[string]any{"token": token, "player": player.ID, "room": r})
}

func (s *Server) collection(w http.ResponseWriter, q *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.clean()
	switch q.Method {
	case "GET":
		out := []map[string]any{}
		for _, r := range s.rooms {
			out = append(out, map[string]any{"id": r.ID, "name": r.Name, "players": len(r.Players), "phase": r.Phase, "created": r.Created})
		}
		respond(w, 200, out)
	case "POST":
		var in struct {
			Name   string `json:"name"`
			Player string `json:"player"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, q.Body, 1024)).Decode(&in) != nil {
			fail(w, 400, "Invalid request")
			return
		}
		in.Name = strings.TrimSpace(in.Name)
		in.Player = strings.TrimSpace(in.Player)
		if in.Name == "" || len(in.Name) > 40 || in.Player == "" || len(in.Player) > 24 {
			fail(w, 400, "Enter a room name (up to 40 characters) and player name (up to 24)")
			return
		}
		// Lookup and creation share the same lock, so simultaneous requests cannot
		// create duplicate rooms. Existing rooms remain joinable at capacity.
		for _, r := range s.rooms {
			if strings.EqualFold(r.Name, in.Name) || r.ID == in.Name {
				s.joinRoom(w, r, in.Player)
				return
			}
		}
		if len(s.rooms) >= maxRooms {
			fail(w, 409, "All 100 rooms are occupied. Join an existing room or try again later.")
			return
		}

		now := s.now()
		token := id()
		p := Player{id(), in.Player, "watch"}
		r := &Room{ID: id()[:8], Name: in.Name, Host: p.ID, Created: now, Active: now, Players: []Player{p}, History: []Event{}, Phase: "lobby", tokens: map[string]string{token: p.ID}, listeners: map[chan []byte]bool{}}
		s.rooms[r.ID] = r
		respond(w, 201, map[string]any{"token": token, "player": p.ID, "room": r})
	default:
		fail(w, 405, "Use GET or POST")
	}
}
func (s *Server) events(w http.ResponseWriter, q *http.Request, rid string) {
	if q.Method != "GET" {
		fail(w, 405, "Use GET")
		return
	}
	f, ok := w.(http.Flusher)
	if !ok {
		fail(w, 500, "Streaming unavailable")
		return
	}
	s.mu.Lock()
	s.clean()
	r := s.rooms[rid]
	if r == nil {
		s.mu.Unlock()
		fail(w, 404, "Room expired")
		return
	}
	if r.tokens[q.URL.Query().Get("token")] == "" {
		s.mu.Unlock()
		fail(w, 401, "Invalid session")
		return
	}
	if len(r.listeners) >= 48 {
		s.mu.Unlock()
		fail(w, 429, "Too many connections")
		return
	}
	ch := make(chan []byte, 8)
	r.listeners[ch] = true
	b, _ := json.Marshal(r)
	ch <- b
	s.mu.Unlock()
	defer func() { s.mu.Lock(); delete(r.listeners, ch); s.mu.Unlock() }()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("X-Accel-Buffering", "no")
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case b, ok := <-ch:
			if !ok {
				return
			}
			if _, err := fmt.Fprintf(w, "data: %s\n\n", b); err != nil {
				return
			}
			f.Flush()
		case <-ticker.C:
			if _, err := io.WriteString(w, ": keepalive\n\n"); err != nil {
				return
			}
			f.Flush()
		case <-q.Context().Done():
			return
		}
	}
}
func main() {
	s := newServer()
	go func() {
		t := time.NewTicker(15 * time.Second)
		defer t.Stop()
		for range t.C {
			s.mu.Lock()
			s.clean()
			s.mu.Unlock()
		}
	}()
	mux := http.NewServeMux()
	mux.Handle("/api/", s)
	web, _ := fs.Sub(assets, "web")
	mux.Handle("/", http.FileServer(http.FS(web)))
	addr := os.Getenv("ADDR")
	if addr == "" {
		addr = ":8080"
	}
	log.Printf("Formula War listening on %s", addr)
	log.Fatal((&http.Server{Addr: addr, Handler: secure(mux), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second}).ListenAndServe())
}
