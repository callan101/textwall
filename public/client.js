(function () {
  const canvas = document.getElementById('wall');
  const ctx = canvas.getContext('2d');
  let CELL_W = 32;
  let CELL_H = 32;
  let COLS = 0;
  let ROWS = 0;
  let cursor = { row: 0, col: 0 };
  let origin = { row: 0, col: 0 }; // top-left cell coordinate
  
  // Zoom state
  let zoom = 1.0;
  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 5.0;
  const ZOOM_STEP = 0.05; // Reduced from 0.1 for slower zoom
  const cells = new Map(); // key "r,c" -> {char, authorId, color}
  const otherCursors = new Map(); // clientId -> {row, col, color}
  let myClientId = null;
  let myColor = '#ffffff';

  // Color picker elements and functions
  const colorPicker = document.getElementById('color-picker');
  const colorPreview = document.getElementById('color-preview');
  const colorSliders = document.getElementById('color-sliders');
  const hueSlider = document.getElementById('hue-slider');
  const brightnessSlider = document.getElementById('brightness-slider');
  const resetZoomBtn = document.getElementById('reset-zoom-btn');
  
  
  function updateColorPreview(color) {
    if (colorPreview) {
      colorPreview.style.backgroundColor = color;
    }
  }
  
  function updateColorPicker(color) {
    myColor = color;
    if (colorPicker) {
      colorPicker.value = color;
    }
    updateColorPreview(color);
    sendColorChange(myColor);
  }
  
  function updateColorFromServer(color) {
    myColor = color;
    if (colorPicker) {
      colorPicker.value = color;
    }
    updateColorPreview(color);
  }

  function sendColorChange(color) {
    if (!socket || socket.readyState !== 1) return;
    socket.send(JSON.stringify({ type: 'color_change', color }));
  }

  // Color conversion functions
  function hexToHsl(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    
    if (max === min) {
      h = s = 0; // achromatic
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    
    return {
      h: Math.round(h * 360),
      s: Math.round(s * 100),
      l: Math.round(l * 100)
    };
  }
  
  function hslToHex(h, s, l) {
    h /= 360;
    s /= 100;
    l /= 100;
    
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    
    let r, g, b;
    if (s === 0) {
      r = g = b = l; // achromatic
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    
    const toHex = (c) => {
      const hex = Math.round(c * 255).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };
    
    return '#' + toHex(r) + toHex(g) + toHex(b);
  }
  
  function updateSlidersFromHex(hex) {
    if (!hueSlider || !brightnessSlider) return;
    const hsl = hexToHsl(hex);
    hueSlider.value = hsl.h;
    brightnessSlider.value = hsl.l;
  }
  
  function updateHexFromSliders() {
    if (!hueSlider || !brightnessSlider || !colorPicker) return;
    const hue = parseInt(hueSlider.value);
    const brightness = parseInt(brightnessSlider.value);
    const hex = hslToHex(hue, 100, brightness); // Full saturation for vibrant colors
    colorPicker.value = hex;
    updateColorPicker(hex);
  }

  // Track if user is actively using sliders
  let isUsingSliders = false;

  // Ensure focus so typing works anywhere
  function focusWall() {
    // Don't steal focus from color picker
    if (document.activeElement === colorPicker) return;
    // Only focus canvas if no input element is focused
    if (document.activeElement === document.body || document.activeElement === canvas) {
      canvas.focus();
    }
  }
  window.addEventListener('pointerdown', focusWall);
  window.addEventListener('keydown', focusWall);
  window.addEventListener('load', focusWall);

  // Connection
  let socket;
  let isApplyingRemote = false;

  function connect() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    socket = new WebSocket(`${protocol}://${location.host}`);

    socket.addEventListener('open', () => {
      // nothing to send yet; wait for snapshot
    });

    socket.addEventListener('message', (event) => {
      const payload = safeParse(event.data);
      if (!payload) return;
      if (payload.type === 'snapshot' && payload.cells && typeof payload.cells === 'object') {
        cells.clear();
        for (const k in payload.cells) {
          const cellData = payload.cells[k];
          if (typeof cellData === 'string') {
            // Legacy format
            const ch = cellData.slice(0,1);
            if (ch) cells.set(k, { char: ch, authorId: 'unknown', color: '#e6e6e6' });
          } else if (cellData && cellData.char) {
            // New format
            const ch = String(cellData.char || '').slice(0,1);
            if (ch) cells.set(k, { 
              char: ch, 
              authorId: cellData.authorId || 'unknown',
              color: cellData.color || '#e6e6e6'
            });
          }
        }
        if (payload.cursors) {
          otherCursors.clear();
          for (const id in payload.cursors) {
            otherCursors.set(id, payload.cursors[id]);
          }
        }
        if (payload.clientId) {
          myClientId = payload.clientId;
        }
        // Set initial color from server
        if (payload.myColor) {
          updateColorFromServer(payload.myColor);
        }
        draw();
      } else if (payload.type === 'cell') {
        const row = Number(payload.row);
        const col = Number(payload.col);
        const ch = typeof payload.char === 'string' ? payload.char.slice(0,1) : '';
        const authorId = payload.authorId || 'unknown';
        const color = payload.color || '#e6e6e6';
        const key = `${row},${col}`;
        if (ch) cells.set(key, { char: ch, authorId, color }); else cells.delete(key);
        draw();
      } else if (payload.type === 'cursor') {
        otherCursors.set(payload.clientId, { row: payload.row, col: payload.col, color: payload.color });
        draw();
      } else if (payload.type === 'cursor_leave') {
        otherCursors.delete(payload.clientId);
        draw();
      } else if (payload.type === 'color_change') {
        if (payload.clientId === myClientId) {
          updateColorFromServer(payload.color);
        } else {
          const otherCursor = otherCursors.get(payload.clientId);
          if (otherCursor) {
            otherCursor.color = payload.color;
            otherCursors.set(payload.clientId, otherCursor);
          }
        }
        // Don't redraw on color change - existing text keeps its original color
      }
    });

    socket.addEventListener('close', () => {
      setTimeout(connect, 500); // simple reconnect
    });
  }

  function safeParse(data) {
    try { return JSON.parse(data); } catch { return null; }
  }

  function sendCell(row, col, ch) {
    if (!socket || socket.readyState !== 1) return;
    socket.send(JSON.stringify({ type: 'cell', row, col, char: ch, color: myColor }));
  }

  function sendCursor(row, col) {
    if (!socket || socket.readyState !== 1) return;
    socket.send(JSON.stringify({ type: 'cursor', row, col, color: myColor }));
  }

  function key(row, col) { return `${row},${col}`; }
  function getChar(row, col) { 
    const cellData = cells.get(key(row,col));
    return cellData ? cellData.char : '';
  }
  function setChar(row, col, ch) {
    // Round to nearest grid position for storage
    const gridRow = Math.round(row);
    const gridCol = Math.round(col);
    const k = key(gridRow, gridCol);
    if (ch) {
      // Use the current myColor for new text
      cells.set(k, { char: ch.slice(0,1), authorId: myClientId, color: myColor });
    } else {
      cells.delete(k);
    }
    sendCell(gridRow, gridCol, ch);
    draw();
  }

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  // Zoom helper functions
  function setZoom(newZoom, centerX = null, centerY = null) {
    const oldZoom = zoom;
    zoom = clamp(newZoom, MIN_ZOOM, MAX_ZOOM);
    
    if (centerX !== null && centerY !== null) {
      // Zoom towards the specified point
      const rect = canvas.getBoundingClientRect();
      
      // Calculate the world coordinates of the zoom center point
      const worldCol = origin.col + centerX / (CELL_W * oldZoom);
      const worldRow = origin.row + centerY / (CELL_H * oldZoom);
      
      // Adjust origin so the same world point appears at the same screen position
      origin.col = worldCol - centerX / (CELL_W * zoom);
      origin.row = worldRow - centerY / (CELL_H * zoom);
    }
    
    draw();
  }

  function zoomIn(centerX = null, centerY = null) {
    setZoom(zoom + ZOOM_STEP, centerX, centerY);
  }

  function zoomOut(centerX = null, centerY = null) {
    setZoom(zoom - ZOOM_STEP, centerX, centerY);
  }

  function resetZoom() {
    setZoom(1.0);
  }

  function resetZoomAndCenter() {
    // Reset zoom to 1.0
    zoom = 1.0;
    
    // Set cursor to origin (0,0)
    cursor.col = 0;
    cursor.row = 0;
    
    // Center the view on the cursor at (0,0) - same as initial page load
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    origin.col = -Math.floor(w / (CELL_W * zoom) / 2);
    origin.row = -Math.floor(h / (CELL_H * zoom) / 2);
    
    sendCursor(cursor.row, cursor.col);
    draw();
    
    // Ensure canvas has focus so typing works immediately
    canvas.focus();
  }

  // Pinch gesture helper functions
  function getDistance(touch1, touch2) {
    const dx = touch1.clientX - touch2.clientX;
    const dy = touch1.clientY - touch2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function getCenter(touch1, touch2) {
    return {
      x: (touch1.clientX + touch2.clientX) / 2,
      y: (touch1.clientY + touch2.clientY) / 2
    };
  }

  function gridClickToCaret(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = (e.clientX !== undefined ? e.clientX : e.x) || 0;
    const clientY = (e.clientY !== undefined ? e.clientY : e.y) || 0;
    const x = clamp(clientX - rect.left, 0, rect.width - 1);
    const y = clamp(clientY - rect.top, 0, rect.height - 1);
    // Account for zoom when converting screen coordinates to grid coordinates
    cursor.col = origin.col + x / (CELL_W * zoom);
    cursor.row = origin.row + y / (CELL_H * zoom);
    // Snap cursor to grid when placing it - use floor to always go to the cell you click in
    cursor.col = Math.floor(cursor.col);
    cursor.row = Math.floor(cursor.row);
    sendCursor(cursor.row, cursor.col);
    draw();
  }

  function placeCursorAtPosition(row, col) {
    // Convert row/col to offset in textContent
    const lines = getLines();
    row = clamp(row, 0, lines.length - 1);
    col = clamp(col, 0, lines[row].length);
    let offset = 0;
    for (let i = 0; i < row; i++) offset += lines[i].length + 1; // +1 for \n
    offset += col;

    const range = document.createRange();
    let node = wall.firstChild;
    if (!node) {
      wall.appendChild(document.createTextNode(''));
      node = wall.firstChild;
    }
    range.setStart(node, clamp(offset, 0, (node.textContent || '').length));
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function getCaretRowCol() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return { row: 0, col: 0 };
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    const offset = range.startOffset + (node === wall ? 0 : 0);
    const text = wall.textContent || '';
    const before = text.slice(0, offset);
    const lines = before.split('\n');
    const row = lines.length - 1;
    const col = lines[lines.length - 1].length;
    return { row, col };
  }

  function setCharAt(row, col, ch) {
    const lines = getLines();
    while (lines.length <= row) lines.push('');
    const line = lines[row];
    const pad = Math.max(0, col - line.length);
    const padded = pad > 0 ? line + ' '.repeat(pad) : line;
    const updated = padded.substring(0, col) + ch + padded.substring(col + 1);
    lines[row] = updated;
    setFromLines(lines);
  }

  function deleteCharAt(row, col) {
    const lines = getLines();
    if (row >= lines.length) return;
    const line = lines[row];
    if (col >= line.length) return;
    lines[row] = line.substring(0, col) + ' ' + line.substring(col + 1);
    setFromLines(lines);
  }

  function getApproxCharWidth() {
    // Use a fixed cell width for consistency across devices
    // This ensures the same grid layout on all devices
    return 20;
  }

  function getLineHeightPx() {
    // Approx from font size * 1.1 (shorter than before)
    const fs = 28;
    return Math.round(fs * 1.1);
  }

  function getFontSpec() {
    return '28px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
  }

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    // Use document.documentElement dimensions for consistency across devices
    const w = Math.floor(document.documentElement.clientWidth);
    const h = Math.floor(document.documentElement.clientHeight);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    CELL_W = Math.round(getApproxCharWidth());
    CELL_H = Math.round(getLineHeightPx());
    COLS = Math.max(1, Math.floor(w / CELL_W));
    ROWS = Math.max(1, Math.floor(h / CELL_H));
    
    // Start cursor at origin (0,0) for consistency across devices
    cursor.col = 0;
    cursor.row = 0;
    
    // Center the view on the cursor at (0,0)
    // This makes the cursor appear in the center of the viewport
    origin.col = -Math.floor(w / (CELL_W * zoom) / 2);
    origin.row = -Math.floor(h / (CELL_H * zoom) / 2);
    
    
    draw();
  }

  window.addEventListener('resize', resizeCanvas);
  
  // Ensure canvas is fully rendered before initial positioning
  setTimeout(() => {
    resizeCanvas();
  }, 0);

  function draw() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    
    // Apply zoom transformation
    ctx.save();
    ctx.scale(zoom, zoom);
    
    // background
    ctx.fillStyle = '#0d0f12';
    ctx.fillRect(0, 0, w / zoom, h / zoom);
    
    // grid - draw relative to origin offset
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1 / zoom; // Scale line width with zoom
    
    // Calculate grid offset from origin (handle fractional coordinates properly)
    const gridOffsetX = -(origin.col * CELL_W) % CELL_W;
    const gridOffsetY = -(origin.row * CELL_H) % CELL_H;
    
    // Ensure positive offsets
    const adjustedGridOffsetX = gridOffsetX < 0 ? gridOffsetX + CELL_W : gridOffsetX;
    const adjustedGridOffsetY = gridOffsetY < 0 ? gridOffsetY + CELL_H : gridOffsetY;
    
    // Vertical lines - start from adjusted offset and draw across screen
    for (let x = adjustedGridOffsetX; x <= w / zoom + CELL_W; x += CELL_W) {
      ctx.beginPath(); 
      ctx.moveTo(x + 0.5, 0); 
      ctx.lineTo(x + 0.5, h / zoom); 
      ctx.stroke();
    }
    
    // Horizontal lines - start from adjusted offset and draw across screen
    for (let y = adjustedGridOffsetY; y <= h / zoom + CELL_H; y += CELL_H) {
      ctx.beginPath(); 
      ctx.moveTo(0, y + 0.5); 
      ctx.lineTo(w / zoom, y + 0.5); 
      ctx.stroke();
    }
    // text - render with colors based on who typed it
    ctx.font = getFontSpec();
    ctx.textBaseline = 'top';
    for (const [k, cellData] of cells) {
      const [r, c] = k.split(',').map(Number);
      const relC = c - origin.col;
      const relR = r - origin.row;
      const x = relC * CELL_W;
      const y = relR * CELL_H;
      if (x + CELL_W < 0 || y + CELL_H < 0 || x > w / zoom || y > h / zoom) continue;
      
      // Use the stored color for this character
      ctx.fillStyle = cellData.color || '#e6e6e6';
      // Center the text in the cell
      const textX = x + CELL_W / 2;
      const textY = y + CELL_H / 2;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(cellData.char, textX, textY);
    }
    // Reset text alignment
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    // other users' cursors
    for (const [clientId, otherCursor] of otherCursors) {
      if (clientId === myClientId) continue; // Skip my own cursor - it's drawn separately
      const otherX = (otherCursor.col - origin.col) * CELL_W;
      const otherY = (otherCursor.row - origin.row) * CELL_H;
      if (otherX >= -CELL_W && otherX <= w / zoom && otherY >= -CELL_H && otherY <= h / zoom) {
        ctx.fillStyle = otherCursor.color + '40'; // add transparency
        ctx.fillRect(otherX, otherY, CELL_W, CELL_H);
      }
    }
    
    // my cursor as full-cell highlight - use my color
    ctx.fillStyle = myColor + '40'; // add transparency
    // Calculate cursor position relative to viewport
    const curX = (cursor.col - origin.col) * CELL_W;
    const curY = (cursor.row - origin.row) * CELL_H;
    // Only draw if cursor is visible in viewport
    if (curX >= -CELL_W && curX <= w / zoom && curY >= -CELL_H && curY <= h / zoom) {
      ctx.fillRect(curX, curY, CELL_W, CELL_H);
    }
    
    // Restore transformation
    ctx.restore();
  }

  function updateGridMetrics() {
    CELL_W = getApproxCharWidth();
    CELL_H = getLineHeightPx();
    wall.style.setProperty('--cellW', `${CELL_W}px`);
    wall.style.setProperty('--cellH', `${CELL_H}px`);
  }

  window.addEventListener('resize', updateGridMetrics);
  updateGridMetrics();

  function getText() {
    // textContent preserves \n and \u00A0 reliably for our caret math
    return wall.textContent || '';
  }

  let sendTimer = null;
  function scheduleSend() {
    if (sendTimer) return;
    sendTimer = setTimeout(() => {
      sendTimer = null;
      sendUpdate();
    }, 60); // tiny debounce
  }

  function sendUpdate() {
    if (!socket || socket.readyState !== 1) return;
    if (isApplyingRemote) return;
    const text = getText();
    if (text === lastSent) return;
    lastSent = text;
    socket.send(JSON.stringify({ type: 'update', text }));
  }

  wall.addEventListener('input', (e) => {
    // Prevent adding lines that exceed viewport height
    const rect = wall.getBoundingClientRect();
    const maxRows = Math.max(1, Math.floor(rect.height / CELL_H));
    let lines = getLines();
    if (lines.length > maxRows) {
      lines = lines.slice(0, maxRows);
      setFromLines(lines);
      placeCursorAtEnd(wall);
    }
    scheduleSend();
  });
  wall.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  });

  // Prevent Enter from creating lines past viewport
  wall.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const rect = wall.getBoundingClientRect();
      const maxRows = Math.max(1, Math.floor(rect.height / CELL_H));
      const lines = getLines();
      if (lines.length >= maxRows) {
        e.preventDefault();
      }
    }
  });

  function handleMouseDown(e) {
    if (e.button !== 0) return; // left click only
    
    // Store initial mouse position for drag detection
    const initialMouse = { x: e.clientX, y: e.clientY, time: Date.now() };
    
    // Set up drag detection
    const handleMouseMove = (moveEvent) => {
      const dx = Math.abs(moveEvent.clientX - initialMouse.x);
      const dy = Math.abs(moveEvent.clientY - initialMouse.y);
      
      // If moved more than 5 pixels, start dragging
      if (dx > 5 || dy > 5) {
        isDragging = true;
        dragStart.x = initialMouse.x;
        dragStart.y = initialMouse.y;
        dragStart.originRow = origin.row;
        dragStart.originCol = origin.col;
        canvas.removeEventListener('mousemove', handleMouseMove);
        canvas.removeEventListener('mouseup', handleMouseUp);
      }
    };
    
    const handleMouseUp = (upEvent) => {
      const dx = Math.abs(upEvent.clientX - initialMouse.x);
      const dy = Math.abs(upEvent.clientY - initialMouse.y);
      const dt = Date.now() - initialMouse.time;
      
      // If it's a click (small movement, short duration), place cursor
      if (dx < 5 && dy < 5 && dt < 300) {
        canvas.focus();
        gridClickToCaret(e);
      }
      
      // Clean up event listeners
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
    };
    
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    e.preventDefault();
    e.stopPropagation();
  }

  function handleTouchStart(e) {
    const touches = e.touches;
    if (!touches || touches.length === 0) return;
    
    // Update active touches map
    for (let i = 0; i < touches.length; i++) {
      const touch = touches[i];
      activeTouches.set(touch.identifier, {
        clientX: touch.clientX,
        clientY: touch.clientY,
        startTime: Date.now()
      });
    }
    
    // Handle pinch gesture (two fingers)
    if (touches.length === 2) {
      // Track if we were previously dragging
      wasDraggingBeforePinch = isTouchDragging;
      
      isPinching = true;
      isTouchDragging = false;
      
      const distance = getDistance(touches[0], touches[1]);
      const center = getCenter(touches[0], touches[1]);
      const rect = canvas.getBoundingClientRect();
      
      pinchStart.distance = distance;
      pinchStart.centerX = center.x - rect.left;
      pinchStart.centerY = center.y - rect.top;
      pinchStart.zoom = zoom;
      
      // Initialize gesture tracking
      gestureMode = 'none';
      lastGestureCenter.x = pinchStart.centerX;
      lastGestureCenter.y = pinchStart.centerY;
      
      // If we were previously dragging, ensure continuity by not resetting reference points
      if (wasDraggingBeforePinch) {
        // Keep the current origin position to maintain continuity
        // The pinch gesture will start from the current view position
      }
      
      
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    
    // Handle single touch
    const t = touches[0];
    primaryTouchId = t.identifier;
    const initialTouch = { x: t.clientX, y: t.clientY, time: Date.now() };
    
    // Ensure touch reference points are properly synchronized with current view state
    touchStart.x = t.clientX;
    touchStart.y = t.clientY;
    touchStart.originRow = origin.row;
    touchStart.originCol = origin.col;
    touchStart.time = Date.now();
    isTouchDragging = false;
    
    
    // Set up touch end handler
    const handleTouchEnd = (endEvent) => {
      const endTouch = endEvent.changedTouches && endEvent.changedTouches[0];
      if (!endTouch) return;
      
      const dx = Math.abs(endTouch.clientX - initialTouch.x);
      const dy = Math.abs(endTouch.clientY - initialTouch.y);
      const dt = Date.now() - initialTouch.time;
      
      // If it's a tap (small movement, short duration) and not a drag, focus input and place cursor
      if (dx < 10 && dy < 10 && dt < 300 && !isTouchDragging && !isPinching) {
        const currentTime = Date.now();
        const currentPosition = { x: t.clientX, y: t.clientY };
        
        // Check for double-tap to reset zoom
        if (currentTime - lastTapTime < 300 && 
            Math.abs(currentPosition.x - lastTapPosition.x) < 20 &&
            Math.abs(currentPosition.y - lastTapPosition.y) < 20) {
          resetZoom();
          lastTapTime = 0; // Reset to prevent triple-tap
        } else {
          // Single tap - focus input and place cursor
          const mobileInput = document.getElementById('mobile-input');
          if (mobileInput) {
            mobileInput.focus();
          }
          const fakeEvent = { clientX: t.clientX, clientY: t.clientY };
          gridClickToCaret(fakeEvent);
          
          // Store tap info for double-tap detection
          lastTapTime = currentTime;
          lastTapPosition = currentPosition;
        }
      }
      
      // Clean up
      isTouchDragging = false;
      isPinching = false;
      canvas.removeEventListener('touchend', handleTouchEnd);
    };
    
    canvas.addEventListener('touchend', handleTouchEnd);
    e.preventDefault();
    e.stopPropagation();
  }

  canvas.tabIndex = 0;
  canvas.addEventListener('mousedown', handleMouseDown);
  canvas.addEventListener('touchstart', handleTouchStart, { passive: false });

  // Mobile input handling
  const mobileInput = document.getElementById('mobile-input');
  if (mobileInput) {
    mobileInput.addEventListener('input', (e) => {
      const value = e.target.value;
      if (value.length > 0) {
        const char = value[value.length - 1];
        setChar(cursor.row, cursor.col, char);
        cursor.col += 1;
        ensureCursorVisible();
        sendCursor(cursor.row, cursor.col);
        draw();
        e.target.value = ''; // Clear the input
      }
    });

    mobileInput.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace') {
        cursor.col -= 1;
        if (cursor.col < origin.col) cursor.col = origin.col;
        setChar(cursor.row, cursor.col, '');
        ensureCursorVisible();
        sendCursor(cursor.row, cursor.col);
        draw();
        e.preventDefault();
      } else if (e.key === 'Enter') {
        cursor.row += 1;
        cursor.col = origin.col;
        ensureCursorVisible();
        sendCursor(cursor.row, cursor.col);
        draw();
        e.preventDefault();
      } else if (e.key === 'ArrowLeft') {
        cursor.col -= 1;
        ensureCursorVisible();
        sendCursor(cursor.row, cursor.col);
        draw();
        e.preventDefault();
      } else if (e.key === 'ArrowRight') {
        cursor.col += 1;
        ensureCursorVisible();
        sendCursor(cursor.row, cursor.col);
        draw();
        e.preventDefault();
      } else if (e.key === 'ArrowUp') {
        cursor.row -= 1;
        ensureCursorVisible();
        sendCursor(cursor.row, cursor.col);
        draw();
        e.preventDefault();
      } else if (e.key === 'ArrowDown') {
        cursor.row += 1;
        ensureCursorVisible();
        sendCursor(cursor.row, cursor.col);
        draw();
        e.preventDefault();
      }
    });
  }

  // Keyboard handling for canvas grid
  window.addEventListener('keydown', (e) => {
    // Handle zoom shortcuts globally
    if (e.ctrlKey || e.metaKey) {
      if (e.key === '=' || e.key === '+') {
        zoomIn();
        e.preventDefault();
        return;
      }
      if (e.key === '-') {
        zoomOut();
        e.preventDefault();
        return;
      }
      if (e.key === '0') {
        resetZoom();
        e.preventDefault();
        return;
      }
    }
    
    if (document.activeElement !== canvas) return;
    const k = e.key;
    if (k.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      setChar(cursor.row, cursor.col, k);
      cursor.col += 1;
      ensureCursorVisible();
      sendCursor(cursor.row, cursor.col);
      draw();
      e.preventDefault();
      return;
    }
    if (k === 'Backspace') {
      cursor.col -= 1;
      if (cursor.col < origin.col) cursor.col = origin.col;
      setChar(cursor.row, cursor.col, '');
      ensureCursorVisible();
      sendCursor(cursor.row, cursor.col);
      draw();
      e.preventDefault();
      return;
    }
    if (k === 'Enter') {
      cursor.row += 1;
      cursor.col = origin.col;
      ensureCursorVisible();
      sendCursor(cursor.row, cursor.col);
      draw();
      e.preventDefault();
      return;
    }
    if (k === 'ArrowLeft') { cursor.col -= 1; ensureCursorVisible(); sendCursor(cursor.row, cursor.col); draw(); e.preventDefault(); }
    if (k === 'ArrowRight') { cursor.col += 1; ensureCursorVisible(); sendCursor(cursor.row, cursor.col); draw(); e.preventDefault(); }
    if (k === 'ArrowUp') { cursor.row -= 1; ensureCursorVisible(); sendCursor(cursor.row, cursor.col); draw(); e.preventDefault(); }
    if (k === 'ArrowDown') { cursor.row += 1; ensureCursorVisible(); sendCursor(cursor.row, cursor.col); draw(); e.preventDefault(); }
  });

  function ensureCursorVisible() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const left = origin.col;
    const top = origin.row;
    const right = origin.col + Math.floor(w / (CELL_W * zoom)) - 1;
    const bottom = origin.row + Math.floor(h / (CELL_H * zoom)) - 1;
    if (cursor.col < left) origin.col = cursor.col;
    if (cursor.col > right) origin.col = cursor.col - Math.floor(w / (CELL_W * zoom)) + 1;
    if (cursor.row < top) origin.row = cursor.row;
    if (cursor.row > bottom) origin.row = cursor.row - Math.floor(h / (CELL_H * zoom)) + 1;
    // Allow fractional origin coordinates for precise cursor positioning
  }

  // Panning with wheel and drag
  canvas.addEventListener('wheel', (e) => {
    // Check for zoom (Ctrl/Cmd + wheel or pinch gesture)
    if (e.ctrlKey || e.metaKey || e.deltaMode === 0) {
      // Handle pinch-to-zoom on touchpads (deltaMode === 0 indicates pixel-based scrolling)
      if (e.deltaMode === 0 && Math.abs(e.deltaY) > 0) {
        const rect = canvas.getBoundingClientRect();
        const centerX = e.clientX - rect.left;
        const centerY = e.clientY - rect.top;
        
        // Use a smaller step for touchpad pinch gestures
        const pinchStep = 0.02;
        if (e.deltaY < 0) {
          setZoom(zoom + pinchStep, centerX, centerY);
        } else {
          setZoom(zoom - pinchStep, centerX, centerY);
        }
        e.preventDefault();
        return;
      }
      
      // Handle Ctrl/Cmd + wheel zoom
      const rect = canvas.getBoundingClientRect();
      const centerX = e.clientX - rect.left;
      const centerY = e.clientY - rect.top;
      
      if (e.deltaY < 0) {
        zoomIn(centerX, centerY);
      } else {
        zoomOut(centerX, centerY);
      }
      e.preventDefault();
      return;
    }
    
    // Smooth omnidirectional panning: scale deltas to cell size
    const scale = 0.5; // adjust for sensitivity
    const colDelta = -e.deltaX * scale / (CELL_W * zoom);
    const rowDelta = -e.deltaY * scale / (CELL_H * zoom);
    origin.col += colDelta;
    origin.row += rowDelta;
    draw();
    e.preventDefault();
  }, { passive: false });

  let isDragging = false;
  let dragStart = { x: 0, y: 0, originRow: 0, originCol: 0 };
  let isTouchDragging = false;
  let touchStart = { x: 0, y: 0, originRow: 0, originCol: 0 };
  
  // Pinch gesture tracking
  let isPinching = false;
  let pinchStart = { distance: 0, centerX: 0, centerY: 0, zoom: 1.0 };
  let gestureMode = 'none'; // 'none', 'pinch', 'pan'
  let lastGestureCenter = { x: 0, y: 0 };
  let wasDraggingBeforePinch = false; // Track if we were dragging before starting pinch
  
  // Touch tracking for stable finger identification
  let activeTouches = new Map(); // touchId -> { clientX, clientY, startTime }
  let primaryTouchId = null; // The main touch for single-touch operations
  
  // Double-tap tracking for reset zoom
  let lastTapTime = 0;
  let lastTapPosition = { x: 0, y: 0 };
  
  // Middle and right mouse button drag support
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 1 || e.button === 2 || e.altKey) {
      isDragging = true;
      dragStart.x = e.clientX;
      dragStart.y = e.clientY;
      dragStart.originRow = origin.row;
      dragStart.originCol = origin.col;
      e.preventDefault();
    }
  });
  
  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    origin.col = dragStart.originCol - dx / (CELL_W * zoom);
    origin.row = dragStart.originRow - dy / (CELL_H * zoom);
    draw();
  });
  
  window.addEventListener('mouseup', () => { isDragging = false; });

  // Touch drag support for panning (handled in handleTouchStart above)

  window.addEventListener('touchmove', (e) => {
    const touches = e.touches;
    
    
    // Handle pinch gesture (two fingers)
    if (touches.length === 2) {
      // If we're not already pinching, initialize pinch gesture
      if (!isPinching) {
        // Track if we were previously dragging
        wasDraggingBeforePinch = isTouchDragging;
        
        isPinching = true;
        isTouchDragging = false;
        
        const distance = getDistance(touches[0], touches[1]);
        const center = getCenter(touches[0], touches[1]);
        const rect = canvas.getBoundingClientRect();
        
        pinchStart.distance = distance;
        pinchStart.centerX = center.x - rect.left;
        pinchStart.centerY = center.y - rect.top;
        pinchStart.zoom = zoom;
        
        // Initialize gesture tracking
        gestureMode = 'none';
        lastGestureCenter.x = pinchStart.centerX;
        lastGestureCenter.y = pinchStart.centerY;
        
      }
      const distance = getDistance(touches[0], touches[1]);
      const center = getCenter(touches[0], touches[1]);
      const rect = canvas.getBoundingClientRect();
      const centerX = center.x - rect.left;
      const centerY = center.y - rect.top;
      
      // Determine gesture mode based on movement
      const distanceChange = Math.abs(distance - pinchStart.distance);
      const centerChangeX = centerX - lastGestureCenter.x;
      const centerChangeY = centerY - lastGestureCenter.y;
      const centerMovement = Math.sqrt(centerChangeX * centerChangeX + centerChangeY * centerChangeY);
      
      // Determine gesture mode dynamically
      if (gestureMode === 'none') {
        if (distanceChange > 8) {
          gestureMode = 'pinch';
        } else if (centerMovement > 8) {
          gestureMode = 'pan';
        }
      }
      
      // Execute gesture based on locked mode
      if (gestureMode === 'pinch') {
        const scale = distance / pinchStart.distance;
        const newZoom = pinchStart.zoom * scale;
        // Use current center coordinates (already relative to canvas) instead of stored pinch start
        setZoom(newZoom, centerX, centerY);
      } else if (gestureMode === 'pan') {
        // Pan using the center movement
        origin.col -= centerChangeX / (CELL_W * zoom);
        origin.row -= centerChangeY / (CELL_H * zoom);
        draw();
      } else if (gestureMode === 'none') {
        // Don't execute any gesture - wait for mode to be determined
        // This prevents premature gesture execution that causes snapping
      }
      
      // Update last position for next frame
      lastGestureCenter.x = centerX;
      lastGestureCenter.y = centerY;
      
      e.preventDefault();
      return;
    }
    
    // If we were pinching and now have only one finger, smoothly transition to drag mode
    // Check if we were in pinch mode (either currently pinching OR gesture mode is pinch)
    // Only transition once - use a flag to prevent repeated transitions
    if ((isPinching || gestureMode === 'pinch') && touches.length === 1 && !isTouchDragging) {
      
      // Find the remaining touch and use it as the primary touch
      const remainingTouch = touches[0];
      primaryTouchId = remainingTouch.identifier;
      
      // Update touchStart to the current position of the remaining touch
      // The origin position already reflects the current view state from the pinch gesture
      touchStart.x = remainingTouch.clientX;
      touchStart.y = remainingTouch.clientY;
      touchStart.originRow = origin.row;
      touchStart.originCol = origin.col;
      
      // End pinch mode and allow dragging
      isPinching = false;
      isTouchDragging = true;
      gestureMode = 'pan'; // Reset gesture mode to allow proper single touch panning
      
      
      e.preventDefault();
      return;
    }
    
    // Only handle single touch drag if we have exactly one touch
    if (touches.length !== 1) {
      return;
    }
    
    // Don't execute single touch drag logic if we're in a pinch gesture
    if (isPinching) {
      return;
    }
    
    // Additional safeguard: if we're in a two-finger gesture, don't process single touch
    if (activeTouches.size > 1) {
      return;
    }
    
    // Find the primary touch by ID to ensure we're using the same finger
    let touch = null;
    if (primaryTouchId !== null) {
      for (let i = 0; i < touches.length; i++) {
        if (touches[i].identifier === primaryTouchId) {
          touch = touches[i];
          break;
        }
      }
    }
    
    // Fallback to first touch if primary touch not found
    if (!touch) {
      touch = touches[0];
      primaryTouchId = touch.identifier;
    }
    
    const dx = touch.clientX - touchStart.x;
    const dy = touch.clientY - touchStart.y;
    
    // If moved more than 10 pixels, start dragging
    if (!isTouchDragging && !isPinching && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      isTouchDragging = true;
    }
    
    if (isTouchDragging && !isPinching) {
      // Use fractional coordinates for smooth movement
      origin.col = touchStart.originCol - (dx / (CELL_W * zoom));
      origin.row = touchStart.originRow - (dy / (CELL_H * zoom));
      draw();
    }
    e.preventDefault();
  }, { passive: false });

  window.addEventListener('touchend', (e) => { 
    // Remove ended touches from active touches map
    if (e.changedTouches) {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        activeTouches.delete(touch.identifier);
        
        // If the primary touch ended, clear it
        if (touch.identifier === primaryTouchId) {
          primaryTouchId = null;
        }
      }
    }
    
    // Reset states when all fingers are lifted
    if (activeTouches.size === 0) {
      isTouchDragging = false;
      isPinching = false;
      gestureMode = 'none';
      wasDraggingBeforePinch = false;
      primaryTouchId = null;
    }
  });

  // Color picker event listeners
  if (colorPreview && colorPicker) {
    // Click on preview to show input and sliders
    colorPreview.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent canvas from getting focus
      e.preventDefault(); // Prevent any default behavior
      
      // Show the hex input and sliders
      colorPicker.classList.add('show');
      colorSliders.classList.add('show');
      colorPicker.focus();
      colorPicker.select();
      
      // Update sliders to match current color
      updateSlidersFromHex(myColor);
    });
    
    // Mouse down on input to focus it (before click)
    colorPicker.addEventListener('mousedown', (e) => {
      e.stopPropagation(); // Prevent canvas from getting focus
      e.preventDefault(); // Prevent any default behavior
      colorPicker.focus();
    });
    
    // Click on input to focus it
    colorPicker.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent canvas from getting focus
      e.preventDefault(); // Prevent any default behavior
      colorPicker.focus();
    });
    
    colorPicker.addEventListener('blur', () => {
      // Validate and complete the color when user finishes typing
      let color = colorPicker.value.trim();
      
      // Add # if missing
      if (color && !color.startsWith('#')) {
        color = '#' + color;
      }
      
      // Try to complete partial hex codes
      if (color.length === 4 && /^#[A-Fa-f0-9]{3}$/.test(color)) {
        // Convert 3-digit hex to 6-digit (e.g., #fff -> #ffffff)
        const hex = color.slice(1);
        color = '#' + hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        colorPicker.value = color;
        updateColorPicker(color);
      } else if (color.length === 7 && /^#[A-Fa-f0-9]{6}$/.test(color)) {
        // Valid 6-digit hex
        updateColorPicker(color);
      } else if (color.length > 1) {
        // Invalid format - revert to previous valid color
        colorPicker.value = myColor;
      }
      
      // Hide the input and sliders after a short delay, but not if user is using sliders
      setTimeout(() => {
        if (!isUsingSliders) {
          colorPicker.classList.remove('show');
          colorSliders.classList.remove('show');
        }
      }, 100);
    });
    
    // Hide input when Enter is pressed
    colorPicker.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        colorPicker.blur(); // This will trigger validation and hide the input
      } else if (e.key === 'Escape') {
        e.preventDefault();
        colorPicker.classList.remove('show');
        colorSliders.classList.remove('show');
      }
    });
    
    
    colorPicker.addEventListener('input', (e) => {
      let color = e.target.value.trim();
      
      // Add # if missing
      if (color && !color.startsWith('#')) {
        color = '#' + color;
      }
      
      // Validate hex color format - allow partial input while typing
      const validHexPattern = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
      const partialHexPattern = /^#([A-Fa-f0-9]{0,6})$/;
      
      if (validHexPattern.test(color)) {
        updateColorPicker(color);
        updateSlidersFromHex(color);
      } else if (partialHexPattern.test(color) || color === '') {
        // Allow partial hex codes while typing (like #ff9ff)
        e.target.value = color;
        // Don't update preview for partial colors
      } else {
        // Invalid format - revert to previous valid color
        e.target.value = myColor;
      }
    });
  }

  // Add slider event listeners
  if (hueSlider && brightnessSlider) {
    // Track when user starts using sliders
    hueSlider.addEventListener('mousedown', () => {
      isUsingSliders = true;
    });
    brightnessSlider.addEventListener('mousedown', () => {
      isUsingSliders = true;
    });
    
    // Track when user stops using sliders
    hueSlider.addEventListener('mouseup', () => {
      setTimeout(() => {
        isUsingSliders = false;
      }, 100);
    });
    brightnessSlider.addEventListener('mouseup', () => {
      setTimeout(() => {
        isUsingSliders = false;
      }, 100);
    });
    
    // Also handle touch events for mobile
    hueSlider.addEventListener('touchstart', () => {
      isUsingSliders = true;
    });
    brightnessSlider.addEventListener('touchstart', () => {
      isUsingSliders = true;
    });
    
    hueSlider.addEventListener('touchend', () => {
      setTimeout(() => {
        isUsingSliders = false;
      }, 100);
    });
    brightnessSlider.addEventListener('touchend', () => {
      setTimeout(() => {
        isUsingSliders = false;
      }, 100);
    });
    
    // Update color while dragging
    hueSlider.addEventListener('input', updateHexFromSliders);
    brightnessSlider.addEventListener('input', updateHexFromSliders);
  }

  // Hide color picker input and sliders when clicking elsewhere
  document.addEventListener('click', (e) => {
    if (colorPicker && colorPicker.classList.contains('show')) {
      // Check if click is outside the color picker container
      const container = document.getElementById('color-picker-container');
      if (container && !container.contains(e.target)) {
        if (!isUsingSliders) {
          colorPicker.classList.remove('show');
          colorSliders.classList.remove('show');
        }
      }
    }
  });

  // Reset zoom button event listener
  if (resetZoomBtn) {
    resetZoomBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      resetZoomAndCenter();
    });
  }

  connect();
})();


