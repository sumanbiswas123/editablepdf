package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// Embedded WS Server definitions
type WSMessage struct {
	Type     string      `json:"type"`
	SenderID string      `json:"senderId,omitempty"`
	Role     string      `json:"role,omitempty"`
	Data     string      `json:"data,omitempty"` // base64 payload (image/file)
	Filename string      `json:"filename,omitempty"`
	Mimetype string      `json:"mimetype,omitempty"`
	Target   string      `json:"target,omitempty"` // target room id/client id
	Cmd      string      `json:"cmd,omitempty"`
	Jobs     interface{} `json:"jobs,omitempty"`
}

type WSClient struct {
	id   string
	role string
	conn *websocket.Conn
	send chan WSMessage
	room *WSRoom
	srv  *WSServer
}

type WSRoom struct {
	id      string
	clients map[string]*WSClient
	mu      sync.Mutex
	owner   string // client id of mac that owns this paired device room
	srv     *WSServer
}

type WSServer struct {
	rooms   map[string]*WSRoom
	clients map[string]*WSClient
	mu      sync.Mutex
}

var wsUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func newWSServer() *WSServer {
	return &WSServer{
		rooms:   make(map[string]*WSRoom),
		clients: make(map[string]*WSClient),
	}
}

func (s *WSServer) getOrCreateRoom(id string) *WSRoom {
	s.mu.Lock()
	defer s.mu.Unlock()
	if r, ok := s.rooms[id]; ok {
		return r
	}
	r := &WSRoom{id: id, clients: make(map[string]*WSClient), srv: s}
	s.rooms[id] = r
	return r
}

func (s *WSServer) generateRoomID() string {
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
	return uuid.New().String()[:6] // fallback unique 6 chars
}

func (r *WSRoom) notifyOwnerOfClients() {
	if r.owner == "" {
		return
	}
	r.mu.Lock()
	clientsList := []string{}
	for _, c := range r.clients {
		if c.role == "windows" {
			clientsList = append(clientsList, c.id[:8]) // Short client identifier
		}
	}
	r.mu.Unlock()

	b, _ := json.Marshal(clientsList)
	r.srv.mu.Lock()
	ownerClient, ok := r.srv.clients[r.owner]
	r.srv.mu.Unlock()
	if ok {
		ownerClient.send <- WSMessage{Type: "devices_list", Data: string(b)}
	}
}

func (r *WSRoom) broadcast(msg WSMessage, exceptID string) {
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

func (s *WSServer) handleCreateRoom(w http.ResponseWriter, r *http.Request) {
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

func (s *WSServer) handleWS(w http.ResponseWriter, r *http.Request) {
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

	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("upgrade err:", err)
		return
	}

	client := &WSClient{
		id:   uuid.New().String(),
		role: role,
		conn: conn,
		send: make(chan WSMessage, 64),
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

func (c *WSClient) readPump() {
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

	c.conn.SetReadLimit(50 << 20) // 50MiB
	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		var msg WSMessage
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
				c.send <- WSMessage{Type: "device_created", Data: id}
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
				c.send <- WSMessage{Type: "devices_list", Data: string(b)}
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

func (c *WSClient) writePump() {
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

// Bindable WS actions in App
var (
	embeddedServer   *WSServer
	embeddedServerMu sync.Mutex
	serverStarted    bool
)

// StartEmbeddedWSServer starts the websocket server inside the Wails application
func (a *App) StartEmbeddedWSServer() string {
	embeddedServerMu.Lock()
	defer embeddedServerMu.Unlock()
	if serverStarted {
		return "Running"
	}

	embeddedServer = newWSServer()
	mux := http.NewServeMux()
	mux.HandleFunc("/create-room", embeddedServer.handleCreateRoom)
	mux.HandleFunc("/ws", embeddedServer.handleWS)

	go func() {
		log.Println("Embedded WebSocket Server running on :8081")
		if err := http.ListenAndServe(":8081", mux); err != nil {
			log.Println("Embedded server ListenAndServe error:", err)
		}
	}()

	serverStarted = true
	return "Started"
}

// GetPlatform returns the current operating system (windows, darwin, etc)
func (a *App) GetPlatform() string {
	return runtime.GOOS
}

// GetLocalIPAddresses retrieves non-loopback local network IPs
func (a *App) GetLocalIPAddresses() []string {
	var ips []string
	ifaces, err := net.Interfaces()
	if err != nil {
		return ips
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			if ip == nil || ip.IsLoopback() {
				continue
			}
			ip = ip.To4()
			if ip == nil {
				continue
			}
			ips = append(ips, ip.String())
		}
	}
	return ips
}

// SaveRemotePDF saves raw base64 PDF bytes into the local compiled output folder
func (a *App) SaveRemotePDF(filename string, base64Data string) (string, error) {
	if a.currentDir == "" {
		return "", fmt.Errorf("workspace root directory not loaded or empty")
	}

	data, err := base64.RawStdEncoding.DecodeString(base64Data)
	if err != nil {
		data, err = base64.StdEncoding.DecodeString(base64Data)
		if err != nil {
			return "", fmt.Errorf("failed to decode base64 PDF payload: %w", err)
		}
	}

	// Save to the presentation directory's PDF output path
	outputPath := filepath.Join(a.currentDir, filename)
	err = os.WriteFile(outputPath, data, 0644)
	if err != nil {
		return "", fmt.Errorf("failed to write compiled PDF file: %w", err)
	}

	return outputPath, nil
}
