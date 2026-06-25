package main

import (
	"context"
	"crypto/rand"
	"embed"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// appAssets holds the embedded frontend/dist for serving via the HTTP server
var appAssets embed.FS

// SetAppAssets registers the embedded assets FS so the embedded HTTP server can serve the frontend UI
func SetAppAssets(a embed.FS) {
	appAssets = a
}

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
	name string
	conn *websocket.Conn
	send chan WSMessage
	room *WSRoom
	srv  *WSServer
}

var MaxRooms = 10

type WSRoom struct {
	id          string
	clients     map[string]*WSClient
	mu          sync.Mutex
	owner       string // client id of mac that owns this paired device room
	srv         *WSServer
	createdAt   time.Time
	isRendering bool // flag to pause room timeout during compilation/rendering
}

type WSServer struct {
	rooms   map[string]*WSRoom
	clients map[string]*WSClient
	mu      sync.Mutex
	app     *App
}

var wsUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func newWSServer(app *App) *WSServer {
	return &WSServer{
		rooms:   make(map[string]*WSRoom),
		clients: make(map[string]*WSClient),
		app:     app,
	}
}

func (s *WSServer) getOrCreateRoom(id string) (*WSRoom, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if r, ok := s.rooms[id]; ok {
		return r, nil
	}
	if len(s.rooms) >= MaxRooms {
		return nil, fmt.Errorf("Maximum room limit of %d reached", MaxRooms)
	}
	r := &WSRoom{
		id:        id,
		clients:   make(map[string]*WSClient),
		srv:       s,
		createdAt: time.Now(),
	}
	s.rooms[id] = r
	return r, nil
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
			clientsList = append(clientsList, c.name) // Logged-in user's name
		}
	}
	r.mu.Unlock()

	b, _ := json.Marshal(clientsList)
	r.srv.mu.Lock()
	ownerClient, ok := r.srv.clients[r.owner]
	r.srv.mu.Unlock()
	if ok {
		ownerClient.send <- WSMessage{Type: "devices_list", Data: string(b), Target: r.id}
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
	_, err := s.getOrCreateRoom(id)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"room": id, "createdAt": time.Now().Format(time.RFC3339)})
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
	name := q.Get("name")
	if name == "" {
		if role == "windows" {
			name = "Windows Device"
		} else if role == "mac" {
			name = "Mac Performer"
		} else {
			name = role
		}
	}

	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("upgrade err:", err)
		return
	}

	client := &WSClient{
		id:   uuid.New().String(),
		role: role,
		name: name,
		conn: conn,
		send: make(chan WSMessage, 64),
		srv:  s,
	}

	s.mu.Lock()
	s.clients[client.id] = client
	s.mu.Unlock()

	room, err := s.getOrCreateRoom(roomID)
	if err != nil {
		_ = conn.WriteJSON(WSMessage{
			Type: "error",
			Data: err.Error(),
		})
		_ = conn.Close()
		s.mu.Lock()
		delete(s.clients, client.id)
		s.mu.Unlock()
		return
	}

	room.mu.Lock()
	if role == "windows" {
		for _, c := range room.clients {
			if c.role == "windows" {
				room.mu.Unlock()
				_ = conn.WriteJSON(WSMessage{
					Type: "error",
					Data: "This pairing code is already in use by another device.",
				})
				_ = conn.Close()
				s.mu.Lock()
				delete(s.clients, client.id)
				s.mu.Unlock()
				return
			}
		}
	}
	room.mu.Unlock()

	client.room = room

	room.mu.Lock()
	room.clients[client.id] = client
	if role == "mac" && room.owner == "" {
		room.owner = client.id
	}
	room.mu.Unlock()

	room.notifyOwnerOfClients()



	// Send initial room timer info to the newly connected client
	client.send <- WSMessage{
		Type:   "room_info",
		Data:   room.createdAt.Format(time.RFC3339),
		Target: room.id,
	}

	go client.writePump()
	client.readPump()
}

func (c *WSClient) readPump() {
	defer func() {
		if c.room != nil {
			c.room.mu.Lock()
			delete(c.room.clients, c.id)
			isOwner := c.room.owner == c.id
			if isOwner {
				c.room.owner = ""
			}
			c.room.mu.Unlock()
			c.room.notifyOwnerOfClients()

			if isOwner {
				if c.srv != nil {
					c.srv.mu.Lock()
					delete(c.srv.rooms, c.room.id)
					if len(c.srv.rooms) == 0 {
						newRoomID := c.srv.generateRoomIDNoLock()
						newRoom := &WSRoom{
							id:        newRoomID,
							clients:   make(map[string]*WSClient),
							srv:       c.srv,
							createdAt: time.Now(),
						}
						c.srv.rooms[newRoomID] = newRoom
						log.Printf("[WSServer] Auto-created new room %s after owner disconnected because it was the only room.", newRoomID)
						if c.srv.app != nil && c.srv.app.app != nil {
							c.srv.app.app.Event.Emit("room_timeout_recreate", map[string]string{
								"oldRoom": c.room.id,
								"newRoom": newRoomID,
							})
							c.srv.app.emitViewershipEvent(c.room.id, fmt.Sprintf("Room %s closed by owner. Auto-created new Room %s.", c.room.id, newRoomID))
						}
					}
					c.srv.mu.Unlock()
				}
				c.room.mu.Lock()
				for _, client := range c.room.clients {
					_ = client.conn.WriteJSON(WSMessage{
						Type: "error",
						Data: "The room owner has disconnected. Room closed.",
					})
					_ = client.conn.Close()
				}
				c.room.clients = make(map[string]*WSClient)
				c.room.mu.Unlock()
			}
		}
		if c.srv != nil {
			c.srv.mu.Lock()
			delete(c.srv.clients, c.id)
			c.srv.mu.Unlock()
		}
		c.conn.Close()
	}()

	c.conn.SetReadLimit(1024 << 20) // 1GiB
	c.conn.SetReadDeadline(time.Now().Add(5 * time.Minute))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(5 * time.Minute))
		return nil
	})

	for {
		var msg WSMessage
		if err := c.conn.ReadJSON(&msg); err != nil {
			break
		}
		c.conn.SetReadDeadline(time.Now().Add(5 * time.Minute))
		msg.SenderID = c.id
		msg.Role = c.role

		switch msg.Type {
		case "create_device":
			if c.role == "mac" {
				id := c.srv.generateRoomID()
				r, err := c.srv.getOrCreateRoom(id)
				if err != nil {
					c.send <- WSMessage{Type: "error", Data: err.Error()}
					break
				}
				r.owner = c.id
				c.send <- WSMessage{Type: "device_created", Data: id}
			}
		case "request_room_info":
			if c.room != nil {
				log.Printf("[WSServer] Client %s requested room info for room %s (createdAt: %s)", c.id[:8], c.room.id, c.room.createdAt.Format(time.RFC3339))
				c.send <- WSMessage{
					Type:   "room_info",
					Data:   c.room.createdAt.Format(time.RFC3339),
					Target: c.room.id,
				}
			}
		case "extend_session":
			if c.room != nil {
				c.room.mu.Lock()
				c.room.createdAt = time.Now()
				c.room.mu.Unlock()

				c.room.broadcast(WSMessage{
					Type:   "room_info",
					Data:   c.room.createdAt.Format(time.RFC3339),
					Target: c.room.id,
				}, "")

				if c.srv != nil && c.srv.app != nil {
					c.srv.app.emitViewershipEvent(c.room.id, "Room session extended via client request. Resetting 3-hour limit.")
				}
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
		case "pdf", "proxy_request", "proxy_response", "sync_workspace":
			if msg.Target != "" && c.srv != nil {
				c.srv.mu.Lock()
				targetClient := c.srv.clients[msg.Target]
				c.srv.mu.Unlock()
				if targetClient != nil {
					log.Printf("[WSServer] Routing message %s (%s) -> %s\n", msg.Type, c.id, msg.Target)
					targetClient.send <- msg
				} else {
					log.Printf("[WSServer] Target client %s not found for message %s\n", msg.Target, msg.Type)
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
			c.conn.SetWriteDeadline(time.Now().Add(5 * time.Minute))
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

type ProxyResponse struct {
	Data       string `json:"data"`
	Mimetype   string `json:"mimetype"`
	StatusCode int    `json:"statusCode"`
}

var (
	proxyRequests   = make(map[string]chan ProxyResponse)
	proxyRequestsMu sync.Mutex
)

func (s *WSServer) handleProxyRequest(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/proxy/")
	if path == "" {
		http.Error(w, "empty path", http.StatusBadRequest)
		return
	}

	parts := strings.SplitN(path, "/", 2)
	var roomID string
	var filename string
	if len(parts) == 2 {
		roomID = parts[0]
		filename = parts[1]
	} else {
		roomID = ""
		filename = path
	}

	// Find the paired Windows client in the room
	s.mu.Lock()
	var windowsClient *WSClient
	var ownerID string
	if roomID != "" {
		if room, ok := s.rooms[roomID]; ok {
			for _, client := range room.clients {
				if client.role == "windows" {
					windowsClient = client
					ownerID = room.owner
					break
				}
			}
		}
	}

	// Fallback to checking any room if not found
	if windowsClient == nil {
		for _, room := range s.rooms {
			for _, client := range room.clients {
				if client.role == "windows" {
					windowsClient = client
					ownerID = room.owner
					break
				}
			}
			if windowsClient != nil {
				break
			}
		}
	}
	s.mu.Unlock()

	if windowsClient == nil {
		http.Error(w, "no controller connected", http.StatusServiceUnavailable)
		return
	}

	reqID := uuid.New().String()
	ch := make(chan ProxyResponse, 1)

	proxyRequestsMu.Lock()
	proxyRequests[reqID] = ch
	proxyRequestsMu.Unlock()

	defer func() {
		proxyRequestsMu.Lock()
		delete(proxyRequests, reqID)
		proxyRequestsMu.Unlock()
	}()

	// Send request to Windows Controller
	msg := WSMessage{
		Type:     "proxy_request",
		Target:   windowsClient.id,
		SenderID: ownerID,
		Filename: filename,
		Cmd:      reqID,
	}

	select {
	case windowsClient.send <- msg:
	default:
		http.Error(w, "failed to send request to controller", http.StatusInternalServerError)
		return
	}

	// Wait for response from Windows Controller
	select {
	case resp := <-ch:
		if resp.StatusCode != 0 && resp.StatusCode != http.StatusOK {
			http.Error(w, fmt.Sprintf("proxy error: status %d", resp.StatusCode), resp.StatusCode)
			return
		}
		b, err := base64.StdEncoding.DecodeString(resp.Data)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if resp.Mimetype != "" {
			w.Header().Set("Content-Type", resp.Mimetype)
		}
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Write(b)
	case <-time.After(30 * time.Second):
		http.Error(w, "timeout waiting for controller response", http.StatusGatewayTimeout)
	}
}

// Bindable WS actions in App
var (
	embeddedServer     *WSServer
	embeddedServerMu   sync.Mutex
	serverStarted      bool
	embeddedHTTPServer *http.Server
)

func (s *WSServer) startTimeoutChecker() {
	ticker := time.NewTicker(5 * time.Second)
	go func() {
		for range ticker.C {
			s.checkRoomTimeouts()
		}
	}()
}

func (s *WSServer) checkRoomTimeouts() {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now()
	timeoutDuration := 3 * time.Hour

	if len(s.rooms) == 0 {
		return
	}

	// Find all timed out rooms
	var expiredRooms []*WSRoom
	for _, room := range s.rooms {
		room.mu.Lock()
		isBusy := room.isRendering
		room.mu.Unlock()
		if isBusy {
			continue // Skip checking timeout if the room is busy rendering/compiling
		}
		if now.Sub(room.createdAt) >= timeoutDuration {
			expiredRooms = append(expiredRooms, room)
		}
	}

	if len(expiredRooms) == 0 {
		return
	}

	totalRooms := len(s.rooms)

	for _, room := range expiredRooms {
		// If it is the ONLY room, recreate it
		if totalRooms == 1 {
			log.Printf("[WSServer] Only active room %s timed out. Recreating...", room.id)
			
			// Close all clients in this room
			s.closeRoomClientsNoLock(room)
			delete(s.rooms, room.id)

			// Start a new room
			newRoomID := s.generateRoomIDNoLock()
			newRoom := &WSRoom{
				id:        newRoomID,
				clients:   make(map[string]*WSClient),
				srv:       s,
				createdAt: time.Now(),
			}
			s.rooms[newRoomID] = newRoom
			log.Printf("[WSServer] Auto-created new room %s after timeout.", newRoomID)

			if s.app != nil && s.app.app != nil {
				s.app.app.Event.Emit("room_timeout_recreate", map[string]string{
					"oldRoom": room.id,
					"newRoom": newRoomID,
				})
				s.app.emitViewershipEvent(room.id, fmt.Sprintf("Room %s reached 3-hour limit and has been recreated as Room %s.", room.id, newRoomID))
			}
			// There was only 1 room, which we recreated. We are done checking.
			return
		} else {
			// If there are multiple rooms, close this expired room
			log.Printf("[WSServer] Room %s timed out with multiple rooms active. Closing it.", room.id)
			s.closeRoomClientsNoLock(room)
			delete(s.rooms, room.id)
			totalRooms-- // decrement for other rooms checks in this loop iteration

			if s.app != nil && s.app.app != nil {
				s.app.app.Event.Emit("room_closed_by_timeout", map[string]string{
					"room": room.id,
				})
				s.app.emitViewershipEvent(room.id, fmt.Sprintf("Room %s closed due to 3-hour timeout.", room.id))
			}
		}
	}
}

func (s *WSServer) closeRoomClientsNoLock(room *WSRoom) {
	room.mu.Lock()
	defer room.mu.Unlock()
	for _, client := range room.clients {
		_ = client.conn.WriteJSON(WSMessage{
			Type: "error",
			Data: "This room has expired after the 3-hour timeout.",
		})
		_ = client.conn.Close()
	}
	room.clients = make(map[string]*WSClient)
}

func (s *WSServer) generateRoomIDNoLock() string {
	for i := 0; i < 10; i++ {
		n, err := rand.Int(rand.Reader, big.NewInt(1000000))
		if err != nil {
			break
		}
		id := fmt.Sprintf("%06d", n.Int64())
		_, exists := s.rooms[id]
		if !exists {
			return id
		}
	}
	return uuid.New().String()[:6]
}

// StartEmbeddedWSServer starts the websocket server inside the Wails application
func (a *App) StartEmbeddedWSServer() string {
	embeddedServerMu.Lock()
	defer embeddedServerMu.Unlock()
	if serverStarted {
		return "Running"
	}

	embeddedServer = newWSServer(a)
	embeddedServer.startTimeoutChecker()
	
	mux := http.NewServeMux()
	mux.HandleFunc("/create-room", embeddedServer.handleCreateRoom)
	mux.HandleFunc("/ws", embeddedServer.handleWS)
	mux.HandleFunc("/proxy/", embeddedServer.handleProxyRequest)
	mux.HandleFunc("/combine", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "*")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		path, err := a.CombineCompiledPDFs()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"path": path})
	})

	// Serve the frontend UI (embedded frontend/dist) at the root '/'.
	// This allows Nocodex to load the capture-mode UI inside an iframe at http://localhost:8082/
	if subFS, err := fs.Sub(appAssets, "frontend/dist"); err == nil {
		fileServer := http.FileServer(http.FS(subFS))
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			// CORS headers so the iframe in Nocodex (different origin) can load resources
			w.Header().Set("Access-Control-Allow-Origin", "*")

			urlPath := r.URL.Path
			// SPA fallback: only redirect to index.html for paths with NO file extension
			// (i.e. navigation routes like "/" or "/some/page", NOT "/assets/foo.js" which should 404)
			if urlPath != "/" {
				hasExt := strings.Contains(filepath.Base(urlPath), ".")
				if !hasExt {
					// Navigation route — serve index.html
					r.URL.Path = "/"
				}
				// For asset paths (.js/.css etc.), let the file server handle it naturally
				// (returns 404 if missing, which is correct behavior)
			}
			fileServer.ServeHTTP(w, r)
		})
	} else {
		log.Println("[WSServer] Warning: could not create frontend sub-FS:", err)
	}

	embeddedHTTPServer = &http.Server{
		Addr:    ":8082",
		Handler: mux,
	}

	go func() {
		log.Println("Embedded WebSocket Server running on :8082")
		if err := embeddedHTTPServer.ListenAndServe(); err != http.ErrServerClosed {
			log.Println("Embedded server ListenAndServe error:", err)
		}
	}()

	serverStarted = true
	return "Started"
}

// CleanUpEmbeddedWSServer shuts down the embedded websocket server
func (a *App) CleanUpEmbeddedWSServer() {
	embeddedServerMu.Lock()
	defer embeddedServerMu.Unlock()
	if embeddedHTTPServer != nil {
		log.Println("Shutting down Embedded WebSocket Server on :8081...")
		embeddedHTTPServer.Shutdown(context.Background())
		embeddedHTTPServer = nil
	}
	serverStarted = false
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
	outDir := filepath.Join(a.currentDir, "output")
	if err := os.MkdirAll(outDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create output directory: %w", err)
	}
	outputPath := filepath.Join(outDir, filename)
	err = os.WriteFile(outputPath, data, 0644)
	if err != nil {
		return "", fmt.Errorf("failed to write compiled PDF file: %w", err)
	}

	return outputPath, nil
}

// RestartRoomTimer resets the creation time of a room back to now, restarting its 3-hour limit
func (a *App) RestartRoomTimer(roomCode string) string {
	embeddedServerMu.Lock()
	defer embeddedServerMu.Unlock()
	if embeddedServer == nil {
		return "Server not started"
	}
	embeddedServer.mu.Lock()
	defer embeddedServer.mu.Unlock()
	if r, ok := embeddedServer.rooms[roomCode]; ok {
		r.createdAt = time.Now()
		r.broadcast(WSMessage{
			Type:   "room_info",
			Data:   r.createdAt.Format(time.RFC3339),
			Target: r.id,
		}, "")
		a.emitViewershipEvent(roomCode, "Room timer restarted. Resetting 3-hour timeout limit.")
		return "Success"
	}
	return "Room not found"
}

// SetRoomRenderingState toggles a room's active rendering/busy state and resets its timer once finished.
func SetRoomRenderingState(roomID string, isRendering bool) {
	embeddedServerMu.Lock()
	srv := embeddedServer
	embeddedServerMu.Unlock()

	if srv == nil {
		return
	}

	srv.mu.Lock()
	room, ok := srv.rooms[roomID]
	if ok {
		room.mu.Lock()
		room.isRendering = isRendering
		if !isRendering {
			room.createdAt = time.Now() // Reset session limit when rendering is completed
		}
		room.mu.Unlock()
	}
	srv.mu.Unlock()
}
