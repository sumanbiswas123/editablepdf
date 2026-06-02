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

    "github.com/gorilla/websocket"
    "github.com/google/uuid"
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
    owner   string // client id of mac that owns this paired device room (optional)
}

type Server struct {
    rooms map[string]*Room
    mu    sync.Mutex
    clients map[string]*Client
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
    r := &Room{id: id, clients: make(map[string]*Client)}
    s.rooms[id] = r
    return r
}

func (s *Server) generateRoomID() string {
    // Try to generate a unique 6-digit numeric ID up to a few attempts
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
    // fallback to UUID if collisions or RNG failure
    return uuid.New().String()
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
    // Allow browser clients served from other origins to call this endpoint
    w.Header().Set("Access-Control-Allow-Origin", "*")
    if r.Method == http.MethodOptions {
        // preflight
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

    // register client globally
    s.mu.Lock()
    s.clients[client.id] = client
    s.mu.Unlock()

    room := s.getOrCreateRoom(roomID)
    client.room = room

    room.mu.Lock()
    room.clients[client.id] = client
    room.mu.Unlock()

    go client.writePump()
    client.readPump()
}

func (c *Client) readPump() {
    defer func() {
        if c.room != nil {
            c.room.mu.Lock()
            delete(c.room.clients, c.id)
            c.room.mu.Unlock()
        }
        // unregister global client
        if c.srv != nil {
            c.srv.mu.Lock()
            delete(c.srv.clients, c.id)
            c.srv.mu.Unlock()
        }
        c.conn.Close()
    }()
    // Allow larger files (e.g. up to 50MiB). Adjust as needed for production.
    c.conn.SetReadLimit(50 << 20)
    c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
    c.conn.SetPongHandler(func(string) error { c.conn.SetReadDeadline(time.Now().Add(60 * time.Second)); return nil })
    for {
        var msg Message
        if err := c.conn.ReadJSON(&msg); err != nil {
            // client disconnected or sent invalid JSON
            break
        }
        msg.SenderID = c.id
        msg.Role = c.role

        // handle control messages
        switch msg.Type {
        case "create_device":
            // only allow mac role to create paired device rooms
            if c.role == "mac" {
                id := c.srv.generateRoomID()
                r := c.srv.getOrCreateRoom(id)
                r.owner = c.id
                // reply to creator with device code
                resp := Message{Type: "device_created", Data: id}
                c.send <- resp
            }
        case "list_devices":
            // return list of rooms owned by this client (mac)
            if c.role == "mac" {
                type Dev struct{
                    Room string `json:"room"`
                    Count int   `json:"count"`
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
            // A client (usually Windows) requests a render; forward request to room owner (mac)
            if c.room != nil && c.room.owner != "" && c.srv != nil {
                c.srv.mu.Lock()
                ownerClient := c.srv.clients[c.room.owner]
                c.srv.mu.Unlock()
                if ownerClient != nil {
                    // include original requester id so mac can reply
                    msg.Target = c.id
                    ownerClient.send <- msg
                }
            }
        case "pdf":
            // A mac client sends back a PDF targeted at a specific client id (msg.Target)
            if msg.Target != "" && c.srv != nil {
                c.srv.mu.Lock()
                targetClient := c.srv.clients[msg.Target]
                c.srv.mu.Unlock()
                if targetClient != nil {
                    targetClient.send <- msg
                }
            }
        case "room_command":
            // mac can issue a command targeting a room; server will forward to that room
            if c.role == "mac" && msg.Target != "" {
                c.srv.mu.Lock()
                targetRoom, ok := c.srv.rooms[msg.Target]
                c.srv.mu.Unlock()
                if ok {
                    // broadcast command to room
                    targetRoom.broadcast(msg, "")
                }
            }
        default:
            // Broadcast screenshot or other message to room except sender
            if c.room != nil {
                c.room.broadcast(msg, c.id)
                // also forward to owner (mac) if present
                if c.room.owner != "" && c.srv != nil {
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
    http.HandleFunc("/ws", srv.handleWS)

    log.Println("WebSocket server listening on :8081")
    if err := http.ListenAndServe(":8081", nil); err != nil {
        log.Fatal(err)
    }
}
