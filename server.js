const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// In-memory sparse grid of cells: key "r,c" -> {char, authorId, color}
const cells = new Map();
const cursors = new Map(); // clientId -> {row, col, color}
const selections = new Map(); // clientId -> {startRow, startCol, endRow, endCol, color, selectionMode}
const DATA_FILE = path.join(__dirname, 'cells.json');

// Helper function to get first Unicode character (handles emojis correctly)
function getFirstChar(str) {
  if (!str || str.length === 0) return '';
  // Use Array.from to properly handle Unicode characters including emojis
  const chars = Array.from(str);
  return chars[0] || '';
}

function loadCells() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const obj = JSON.parse(raw);
    for (const k in obj) {
      const cellData = obj[k];
      if (typeof cellData === 'string') {
        // Legacy format: just character
        const ch = getFirstChar(cellData);
        if (ch) cells.set(k, { char: ch, authorId: 'unknown', color: '#e6e6e6' });
      } else if (cellData && cellData.char) {
        // New format: {char, authorId, color}
        const ch = getFirstChar(String(cellData.char || ''));
        if (ch) cells.set(k, { 
          char: ch, 
          authorId: cellData.authorId || 'unknown',
          color: cellData.color || '#e6e6e6'
        });
      }
    }
  } catch (_e) {
    // ignore if missing
  }
}

function saveCells() {
  const obj = {};
  cells.forEach((cellData, k) => { obj[k] = cellData; });
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(obj));
  } catch (_e) {
    // ignore write errors for now
  }
}

loadCells();

// Serve static files from public
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir, {
  setHeaders: (res, path) => {
    // Disable caching for JavaScript files during development
    if (path.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));
app.use(express.json());


// Fallback to index.html (Express 5: avoid '*' pattern)
app.use((_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Broadcast helper
function broadcastAll(data) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

wss.on('connection', (ws) => {
  const clientId = Math.random().toString(36).substr(2, 9);
  const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#feca57', '#ff9ff3', '#54a0ff'];
  const color = colors[Math.floor(Math.random() * colors.length)];
  
  // Send snapshot of current cells, cursors, and selections
  const snapshot = {};
  cells.forEach((ch, key) => { snapshot[key] = ch; });
  const cursorSnapshot = {};
  cursors.forEach((cursor, id) => { cursorSnapshot[id] = cursor; });
  const selectionSnapshot = {};
  selections.forEach((selection, id) => { selectionSnapshot[id] = selection; });
  ws.send(JSON.stringify({ type: 'snapshot', cells: snapshot, cursors: cursorSnapshot, selections: selectionSnapshot, clientId, myColor: color }));

  ws.on('message', (message) => {
    try {
      const payload = JSON.parse(message.toString());
      if (payload.type === 'cell') {
        const row = Number(payload.row);
        const col = Number(payload.col);
        const ch = typeof payload.char === 'string' ? payload.char : '';
        const cellColor = payload.color || color; // Use color from payload, fallback to initial color
        if (Number.isInteger(row) && Number.isInteger(col)) {
          const key = `${row},${col}`;
          const firstChar = getFirstChar(ch);
          if (firstChar && firstChar.length > 0) {
            cells.set(key, { char: firstChar, authorId: clientId, color: cellColor });
          } else {
            cells.delete(key);
          }
          const msg = JSON.stringify({ type: 'cell', row, col, char: firstChar, authorId: clientId, color: cellColor });
          broadcastAll(msg);
          saveCells();
        }
      } else if (payload.type === 'cursor') {
        const row = Number(payload.row);
        const col = Number(payload.col);
        const cursorColor = payload.color || color; // Use color from payload, fallback to initial color
        if (!isNaN(row) && !isNaN(col)) { // Allow fractional coordinates
          cursors.set(clientId, { row, col, color: cursorColor });
          const msg = JSON.stringify({ type: 'cursor', clientId, row, col, color: cursorColor });
          broadcastAll(msg);
        }
      } else if (payload.type === 'color_change') {
        const newColor = payload.color;
        if (typeof newColor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(newColor)) {
          // Update color for this client
          const currentCursor = cursors.get(clientId);
          if (currentCursor) {
            currentCursor.color = newColor;
            cursors.set(clientId, currentCursor);
            // Broadcast cursor update with new color
            const cursorMsg = JSON.stringify({ type: 'cursor', clientId, row: currentCursor.row, col: currentCursor.col, color: newColor });
            broadcastAll(cursorMsg);
          } else {
            // Create cursor if it doesn't exist
            cursors.set(clientId, { row: 0, col: 0, color: newColor });
          }
          // Broadcast color change to all clients
          const msg = JSON.stringify({ type: 'color_change', clientId, color: newColor });
          broadcastAll(msg);
        }
      } else if (payload.type === 'selection') {
        const startRow = Number(payload.startRow);
        const startCol = Number(payload.startCol);
        const endRow = Number(payload.endRow);
        const endCol = Number(payload.endCol);
        const selectionColor = payload.color || color;
        const selectionMode = payload.selectionMode || 0;
        if (!isNaN(startRow) && !isNaN(startCol) && !isNaN(endRow) && !isNaN(endCol)) {
          // Store selection in server memory
          selections.set(clientId, {
            startRow,
            startCol,
            endRow,
            endCol,
            color: selectionColor,
            selectionMode
          });
          const msg = JSON.stringify({ 
            type: 'selection', 
            clientId,
            startRow, 
            startCol,
            endRow,
            endCol,
            color: selectionColor,
            selectionMode
          });
          broadcastAll(msg);
        }
      } else if (payload.type === 'selection_clear') {
        selections.delete(clientId);
        const msg = JSON.stringify({ type: 'selection_clear', clientId });
        broadcastAll(msg);
      }
    } catch (_err) {
      // Ignore malformed messages
    }
  });

  ws.on('close', () => {
    cursors.delete(clientId);
    selections.delete(clientId);
    const cursorMsg = JSON.stringify({ type: 'cursor_leave', clientId });
    broadcastAll(cursorMsg);
    // Also clear selection when user disconnects
    const selectionMsg = JSON.stringify({ type: 'selection_clear', clientId });
    broadcastAll(selectionMsg);
  });
});

const PORT = process.env.PORT || 8101;
server.listen(PORT, () => {
});


