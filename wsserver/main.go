package main

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type Message struct {
	Type     string `json:"type"`
	SenderID string `json:"senderId,omitempty"`
	Role     string `json:"role,omitempty"`
	Data     string `json:"data,omitempty"` // base64 payload (image/file)
	Filename string `json:"filename,omitempty"`
	Mimetype string `json:"mimetype,omitempty"`
	Target   string `json:"target,omitempty"` // target room id
	Cmd      string `json:"cmd,omitempty"`
}

type Client struct {
	id   string
	role string
	conn *websocket.Conn
	send chan Message
	room *Room
	srv  *Server
}

type Room struct {
	id      string
	clients map[string]*Client
	mu      sync.Mutex
	owner   string // client id of mac that owns this paired device room
	srv     *Server
}

type Server struct {
	rooms   map[string]*Room
	clients map[string]*Client
	mu      sync.Mutex
}

var upgrader = websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}

func newServer() *Server {
	return &Server{rooms: make(map[string]*Room), clients: make(map[string]*Client)}
}

func (s *Server) getOrCreateRoom(id string) *Room {
	s.mu.Lock()
	defer s.mu.Unlock()
	if r, ok := s.rooms[id]; ok {
		return r
	}
	r := &Room{id: id, clients: make(map[string]*Client), srv: s}
	s.rooms[id] = r
	return r
}

func (s *Server) generateRoomID() string {
	for i := 0; i < 10; i++ {
		n, err := rand.Int(rand.Reader, big.NewInt(1000000))
		if err != nil {
			break
		}
		id := fmt.Sprintf("%06d", n.Int64())
		s.mu.Lock()
		_, exists := s.rooms[id]
		s.mu.Unlock()
		if !exists {
			return id
		}
	}
	return uuid.New().String()[:6]
}

func (r *Room) notifyOwnerOfClients() {
	if r.owner == "" {
		return
	}
	r.mu.Lock()
	var clientsList []string
	for _, c := range r.clients {
		if c.role == "windows" {
			clientsList = append(clientsList, c.id[:8])
		}
	}
	r.mu.Unlock()

	b, _ := json.Marshal(clientsList)
	r.srv.mu.Lock()
	ownerClient, ok := r.srv.clients[r.owner]
	r.srv.mu.Unlock()
	if ok {
		ownerClient.send <- Message{Type: "devices_list", Data: string(b)}
	}
}

func (r *Room) broadcast(msg Message, exceptID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for id, c := range r.clients {
		if id == exceptID {
			continue
		}
		select {
		case c.send <- msg:
		default:
			// drop slow client
		}
	}
}

func (s *Server) handleCreateRoom(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if r.Method == http.MethodOptions {
		w.Header().Set("Access-Control-Allow-Methods", "GET,OPTIONS")
		w.WriteHeader(http.StatusOK)
		return
	}
	id := s.generateRoomID()
	s.getOrCreateRoom(id)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"room": id})
}

func (s *Server) handleRoot(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("WebSocket room server. Endpoints: /create-room, /ws"))
}

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	roomID := q.Get("room")
	if roomID == "" {
		http.Error(w, "room required", http.StatusBadRequest)
		return
	}
	role := q.Get("role")
	if role == "" {
		role = "guest"
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("upgrade:", err)
		return
	}

	client := &Client{
		id:   uuid.New().String(),
		role: role,
		conn: conn,
		send: make(chan Message, 16),
		srv:  s,
	}

	s.mu.Lock()
	s.clients[client.id] = client
	s.mu.Unlock()

	room := s.getOrCreateRoom(roomID)
	client.room = room

	room.mu.Lock()
	room.clients[client.id] = client
	if role == "mac" && room.owner == "" {
		room.owner = client.id
	}
	room.mu.Unlock()

	room.notifyOwnerOfClients()

	go client.writePump()
	client.readPump()
}

func (c *Client) readPump() {
	defer func() {
		if c.room != nil {
			c.room.mu.Lock()
			delete(c.room.clients, c.id)
			if c.room.owner == c.id {
				c.room.owner = ""
			}
			c.room.mu.Unlock()
			c.room.notifyOwnerOfClients()
		}
		if c.srv != nil {
			c.srv.mu.Lock()
			delete(c.srv.clients, c.id)
			c.srv.mu.Unlock()
		}
		c.conn.Close()
	}()
	c.conn.SetReadLimit(50 << 20)
	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error { c.conn.SetReadDeadline(time.Now().Add(60 * time.Second)); return nil })
	for {
		var msg Message
		if err := c.conn.ReadJSON(&msg); err != nil {
			break
		}
		msg.SenderID = c.id
		msg.Role = c.role

		switch msg.Type {
		case "create_device":
			if c.role == "mac" {
				id := c.srv.generateRoomID()
				r := c.srv.getOrCreateRoom(id)
				r.owner = c.id
				c.send <- Message{Type: "device_created", Data: id}
			}
		case "list_devices":
			if c.role == "mac" {
				type Dev struct {
					Room  string `json:"room"`
					Count int    `json:"count"`
				}
				var list []Dev
				c.srv.mu.Lock()
				for _, room := range c.srv.rooms {
					if room.owner == c.id {
						room.mu.Lock()
						cnt := len(room.clients)
						room.mu.Unlock()
						list = append(list, Dev{Room: room.id, Count: cnt})
					}
				}
				c.srv.mu.Unlock()
				b, _ := json.Marshal(list)
				c.send <- Message{Type: "devices_list", Data: string(b)}
			}
		case "render_request":
			if c.room != nil && c.room.owner != "" && c.srv != nil {
				c.srv.mu.Lock()
				ownerClient := c.srv.clients[c.room.owner]
				c.srv.mu.Unlock()
				if ownerClient != nil {
					msg.Target = c.id
					ownerClient.send <- msg
				}
			}
		case "pdf":
			if msg.Target != "" && c.srv != nil {
				c.srv.mu.Lock()
				targetClient := c.srv.clients[msg.Target]
				c.srv.mu.Unlock()
				if targetClient != nil {
					targetClient.send <- msg
				}
			}
		case "room_command":
			if c.role == "mac" && msg.Target != "" {
				c.srv.mu.Lock()
				targetRoom, ok := c.srv.rooms[msg.Target]
				c.srv.mu.Unlock()
				if ok {
					targetRoom.broadcast(msg, "")
				}
			}
		default:
			if c.room != nil {
				c.room.broadcast(msg, c.id)
				if c.room.owner != "" && c.srv != nil && c.room.owner != c.id {
					c.srv.mu.Lock()
					ownerClient := c.srv.clients[c.room.owner]
					c.srv.mu.Unlock()
					if ownerClient != nil {
						ownerClient.send <- msg
					}
				}
			}
		}
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case msg, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteJSON(msg); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func main() {
	srv := newServer()
	http.HandleFunc("/create-room", srv.handleCreateRoom)
	http.HandleFunc("/", srv.handleRoot)
	http.HandleFunc("/ws", srv.handleWS)

	log.Println("WebSocket server listening on :8081")
	if err := http.ListenAndServe(":8081", nil); err != nil {
		log.Fatal(err)
	}
}
