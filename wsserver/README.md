WebSocket Room Server

Quick start

- Run the server from the `wsserver` folder:

```bash
cd wsserver
go run main.go
```

- The server exposes:
  - `GET /create-room` — returns JSON `{ "room": "<id>" }` where `<id>` is a 6-digit numeric room id (e.g. `042371`).
  - `GET /ws?room=<id>&role=<mac|windows|guest>` — WebSocket endpoint

Frontend demo

- Open the file `frontend/ws_client.html` in a browser. For convenience serve the `frontend` directory (so `/create-room` works against the server host):

```bash
cd frontend
# simple static server (Python 3)
python3 -m http.server 8000
```

- Open `http://localhost:8000/ws_client.html` and use the UI to create a room, select `mac` or `windows`, connect, and send an image (mac uploads a PNG/JPG and broadcasts as base64). Windows clients will render received images but should not save them.
 - Open `http://localhost:8000/ws_client.html` and use the UI to create a room, select `mac` or `windows`, connect, and send an image (mac uploads a PNG/JPG and broadcasts as base64). Windows clients will render received images but should not save them.
 - The demo also supports generic file transfers (including `.zip`). Use the "Send file / zip" control to upload any file; receiving clients will see a "Download: <filename>" link which they can use to download the file.

Notes

- This is a minimal prototype. For production you should:
  - Add authentication and access control.
  - Serve the frontend securely and avoid embedding host/port hacks.
  - Add message size limits and validation for image payloads.
