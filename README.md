TextWall
========

A minimal realtime text wall: type anywhere with anyone.

Features
--------
- **Realtime collaboration**: Multiple users can type simultaneously with instant sync
- **Grid-based text placement**: Click anywhere to place text at precise grid positions
- **Color customization**: Each user gets a unique color for their text and cursor
- **Centered cursor**: Cursor starts in the middle of the viewport for better UX
- **Pan and zoom**: Mouse wheel and drag to navigate the infinite text space
- **Zoom support**: Ctrl/Cmd + wheel, touchpad pinch, mobile pinch gestures, and keyboard shortcuts
- **Persistent storage**: Text is saved to `cells.json` and restored on server restart

Run
---

```bash
npm run start
```

Then open `http://localhost:3000` in multiple windows to see realtime sync.

Usage
-----
- **Type**: Click anywhere and start typing to place text
- **Navigate**: Use arrow keys to move the cursor
- **Pan**: Mouse wheel or middle-click drag to move around
- **Zoom**: 
  - **Desktop**: Ctrl/Cmd + mouse wheel, or touchpad pinch gestures
  - **Mobile**: Pinch with two fingers to zoom in/out
  - **Keyboard**: Ctrl/Cmd + Plus/Minus to zoom, Ctrl/Cmd + 0 to reset
  - **Mobile**: Double-tap to reset zoom
- **Colors**: Click the color picker in the top-right to change your text color
- **Collaborate**: Open multiple browser windows to see real-time collaboration

Deploy to VPS
-------------
1. **Upload files** to your VPS:
   ```bash
   rsync -avz --exclude node_modules . user@your-vps-ip:/path/to/textwall/
   ```

2. **Install Node.js** (if not already installed):
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```

3. **Install dependencies**:
   ```bash
   cd /path/to/textwall
   npm install
   ```

4. **Run the server**:
   ```bash
   node server.js
   ```

5. **Access** at `http://your-vps-ip:8101`

**Optional**: Use PM2 for process management:
```bash
npm install -g pm2
pm2 start server.js --name textwall
pm2 startup
pm2 save
```

Technical Notes
---------------
- Uses WebSockets for real-time synchronization
- Grid-based coordinate system with infinite canvas
- In-memory state with JSON file persistence
- Canvas-based rendering with monospace font
- Each character is stored with position, author, and color information


