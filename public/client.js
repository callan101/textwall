(function () {
  const canvas = document.getElementById('wall');
  const ctx = canvas.getContext('2d');
  // Enable high-quality text rendering
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  let CELL_W = 32;
  let CELL_H = 32;
  
  let cursor = { row: 0, col: 0 };
  
  // Selection state
  let selection = {
    active: false,
    startRow: 0,
    startCol: 0,
    endRow: 0,
    endCol: 0
  };
  let isSelecting = false;
  
  // Selection mode: 0 = normal, 1 = typing boundary, 2 = pan mode
  // Default to pan mode for mobile-friendly behavior
  let selectionMode = 2;
  
  function lightenColor(hexColor, amount = 0.3) {
    // Remove # if present
    hexColor = hexColor.replace('#', '');
    
    // Parse RGB values
    const r = parseInt(hexColor.substring(0, 2), 16);
    const g = parseInt(hexColor.substring(2, 4), 16);
    const b = parseInt(hexColor.substring(4, 6), 16);
    
    // Lighten by blending with white
    const newR = Math.round(r + (255 - r) * amount);
    const newG = Math.round(g + (255 - g) * amount);
    const newB = Math.round(b + (255 - b) * amount);
    
    // Convert back to hex
    return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
  }
  
  function isCellWithinSelection(row, col) {
    if (!selection.active) return false;
    const minRow = Math.min(selection.startRow, selection.endRow);
    const maxRow = Math.max(selection.startRow, selection.endRow);
    const minCol = Math.min(selection.startCol, selection.endCol);
    const maxCol = Math.max(selection.startCol, selection.endCol);
    return row >= minRow && row <= maxRow && col >= minCol && col <= maxCol;
  }
  
  function moveCursorToSelectionStart() {
    if (!selection.active) return;
    const topRow = Math.min(selection.startRow, selection.endRow);
    const leftCol = Math.min(selection.startCol, selection.endCol);
    cursor.row = topRow;
    cursor.col = leftCol;
  }
  
  function jumpCursorTo(row, col, source = 'unknown') {
    cursor.row = row;
    cursor.col = col;
    ensureCursorVisible();
    sendCursor(cursor.row, cursor.col);
    draw();
  }
  
  function formatCursorCoords() {
    return `${Math.round(cursor.col)}, ${Math.round(cursor.row)}`;
  }
  
  function parseCursorInputValue(value) {
    if (!value) return null;
    const trimmed = value.trim();
    const match = trimmed.match(/^\(?\s*(-?\d+)\s*,\s*(-?\d+)\s*\)?$/);
    if (!match) return null;
    return { col: Number(match[1]), row: Number(match[2]) };
  }
  
  let origin = { row: 0, col: 0 }; // top-left cell coordinate
  
  
  // Zoom state
  let zoom = 1.0;
  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 10.0;
  let ZOOM_STEP = 0.05; // Default zoom speed (will be mapped from slider using logarithmic scale)
  const MOUSE_WHEEL_ZOOM_STEP = 0.2; // Faster zoom for mouse wheel only
  const cells = new Map(); // key "r,c" -> {char, authorId, color}
  const otherCursors = new Map(); // clientId -> {row, col, color}
  const otherSelections = new Map(); // clientId -> {startRow, startCol, endRow, endCol, color, selectionMode}
  let myClientId = null;
  let myColor = '#ffffff';
  
  // Undo/Redo system
  const undoStack = []; // Array of {changes: [{row, col, oldChar, newChar}], cursorRow, cursorCol}
  const redoStack = [];
  let isApplyingUndoRedo = false; // Flag to prevent recording undo/redo operations
  const MAX_UNDO_HISTORY = 100;
  let undoBatchTimeout = null; // Timeout for batching consecutive changes
  const MAX_WORD_SEARCH_DISTANCE = 2000;

  function isWordCharacter(ch) {
    if (!ch) return false;
    return /[A-Za-z0-9_]/.test(ch);
  }

  // Color picker elements and functions
  const colorPicker = document.getElementById('color-picker');
  const colorPreview = document.getElementById('color-preview');
  const colorSliders = document.getElementById('color-sliders');
  const colorPickerWrapper = document.getElementById('color-picker-wrapper');
  const colorPickerWindow = document.getElementById('color-picker-window');
  const colorPickerContent = document.querySelector('.color-picker-content');
  const hueSlider = document.getElementById('hue-slider');
  const brightnessSlider = document.getElementById('brightness-slider');
  const resetZoomBtn = document.getElementById('reset-zoom-btn');
  const undoBtn = document.getElementById('undo-btn');
  const pasteBtn = document.getElementById('paste-btn');
  const zoomLevelSlider = document.getElementById('zoom-level-slider');
  const zoomSpeedSlider = document.getElementById('zoom-speed-slider');
  const zoomLevelValue = document.getElementById('zoom-level-value');
  const zoomSpeedValue = document.getElementById('zoom-speed-value');
  const selectionModeBtn = document.getElementById('selection-mode-btn');
  const cellCoordsInput = document.getElementById('cell-coords-input');
  const menuToggleBtn = document.getElementById('menu-toggle-btn');
  const toolbarItems = document.getElementById('toolbar-items');
  const toolbarItemsRight = document.getElementById('toolbar-items-right');
  const infoBtn = document.getElementById('info-btn');
  const infoWindow = document.getElementById('info-window');
  const infoContent = infoWindow ? infoWindow.querySelector('.info-content') : null;
  
  
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

  if (cellCoordsInput) {
    cellCoordsInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation(); // Prevent window keydown handler from processing this
        const parsed = parseCursorInputValue(cellCoordsInput.value);
        if (parsed) {
          cellCoordsInput.classList.remove('invalid');
          jumpCursorTo(parsed.row, parsed.col, 'input-field');
          // Don't update input value or blur immediately - let draw() handle it
          setTimeout(() => {
            cellCoordsInput.value = formatCursorCoords();
            cellCoordsInput.blur();
          }, 0);
        } else {
          cellCoordsInput.classList.add('invalid');
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cellCoordsInput.classList.remove('invalid');
        cellCoordsInput.blur();
        cellCoordsInput.value = formatCursorCoords();
      } else {
        cellCoordsInput.classList.remove('invalid');
      }
    });

    cellCoordsInput.addEventListener('blur', () => {
      cellCoordsInput.classList.remove('invalid');
      cellCoordsInput.value = formatCursorCoords();
    });
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
    const hue = parseFloat(hueSlider.value);
    const brightness = parseFloat(brightnessSlider.value);
    const hex = hslToHex(hue, 100, brightness); // Full saturation for vibrant colors
    colorPicker.value = hex;
    updateColorPicker(hex);
  }
  
  function enterFineControlMode(slider, startY) {
    fineControlMode.active = true;
    fineControlMode.slider = slider;
    fineControlMode.startY = startY;
    fineControlMode.startValue = parseFloat(slider.value); // Use current slider value with fractional precision
    fineControlMode.lastX = fineControlMode.startX; // Initialize lastX to current position
  }
  
  function exitFineControlMode() {
    fineControlMode.active = false;
    fineControlMode.slider = null;
    fineControlMode.startY = 0;
    fineControlMode.startValue = 0;
  }
  
  function handleFineControlMove(touch, slider) {
    if (!fineControlMode.active || fineControlMode.slider !== slider) return;
    
    const rect = slider.getBoundingClientRect();
    const sliderWidth = rect.width;
    const sliderMin = parseInt(slider.min);
    const sliderMax = parseInt(slider.max);
    const sliderRange = sliderMax - sliderMin;
    
    // Update current Y position
    fineControlMode.currentY = touch.clientY;
    
    // Calculate current distance from the slider (not from start position)
    const sliderCenterY = rect.top + rect.height / 2;
    const currentDistance = Math.abs(touch.clientY - sliderCenterY);
    
    // Calculate dynamic sensitivity based on distance from slider
    let sensitivity = 1.0; // Normal sensitivity
    if (currentDistance >= fineControlMode.minDistance) {
      // Use a more gradual curve - square root for slower progression
      const normalizedDistance = Math.min((currentDistance - fineControlMode.minDistance) / (fineControlMode.maxDistance - fineControlMode.minDistance), 1);
      const gradualCurve = Math.sqrt(normalizedDistance); // Square root makes it more gradual
      sensitivity = 1.0 - (gradualCurve * (1.0 - fineControlMode.maxSensitivity));
    }
    
    // Only respond to horizontal movement - calculate delta from last X position
    const deltaX = touch.clientX - fineControlMode.lastX;
    
    // Only update slider if there's actual horizontal movement
    if (Math.abs(deltaX) > 0.5) { // Small threshold to avoid tiny movements
      // Scale the movement by dynamic sensitivity
      const scaledDelta = deltaX * sensitivity;
      
      // Convert to slider value
      const valueChange = (scaledDelta / sliderWidth) * sliderRange;
      const newValue = Math.max(sliderMin, Math.min(sliderMax, fineControlMode.startValue + valueChange));
      
      // Update slider value with fractional precision for smooth movement
      slider.value = newValue;
      
      // Update the start value for next movement
      fineControlMode.startValue = newValue;
      
      // Update color
      updateHexFromSliders();
      
    }
    
    // Update last X position for next movement
    fineControlMode.lastX = touch.clientX;
  }

  // Track if user is actively using sliders
  let isUsingSliders = false;
  
  // Fine control mode for sliders
  let fineControlMode = {
    active: false,
    slider: null,
    startX: 0,
    lastX: 0, // Track last X position to only respond to horizontal movement
    startY: 0,
    currentY: 0, // Track current Y position for dynamic distance calculation
    startValue: 0,
    minDistance: 20, // Minimum distance to start fine control
    maxDistance: 200, // Distance for maximum fine control (increased for more gradual)
    maxSensitivity: 0.2 // Maximum sensitivity (5x more precise, less extreme)
  };

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

  // Prevent page zooming while allowing canvas zoom
  function preventPageZoom(e) {
    // Allow canvas zoom gestures
    if (e.target === canvas) {
      return; // Let canvas handle its own zoom
    }
    
    // Prevent zoom on other elements
    if (e.ctrlKey || e.metaKey) {
      if (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0') {
        e.preventDefault();
        return false;
      }
    }
  }

  // Prevent various zoom gestures
  document.addEventListener('keydown', preventPageZoom, { passive: false });
  document.addEventListener('wheel', (e) => {
    // Only allow wheel zoom on canvas
    if (e.target !== canvas) {
      e.preventDefault();
    }
  }, { passive: false });

  // Prevent double-tap zoom
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (e) => {
    const now = (new Date()).getTime();
    if (now - lastTouchEnd <= 300) {
      e.preventDefault();
    }
    lastTouchEnd = now;
  }, { passive: false });

  // Prevent pinch zoom on non-canvas elements
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1 && e.target !== canvas) {
      e.preventDefault();
    }
  }, { passive: false });

  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1 && e.target !== canvas) {
      e.preventDefault();
    }
  }, { passive: false });

  // Connection
  let socket;

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
            const ch = getFirstChar(cellData);
            if (ch) cells.set(k, { char: ch, authorId: 'unknown', color: '#e6e6e6' });
          } else if (cellData && cellData.char) {
            // New format
            const ch = getFirstChar(String(cellData.char || ''));
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
        if (payload.selections) {
          otherSelections.clear();
          for (const id in payload.selections) {
            if (id !== payload.clientId) { // Don't load our own selection
              otherSelections.set(id, payload.selections[id]);
            }
          }
          draw();
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
        const ch = typeof payload.char === 'string' ? getFirstChar(payload.char) : '';
        const authorId = payload.authorId || 'unknown';
        const color = payload.color || '#e6e6e6';
        const key = `${row},${col}`;
        if (ch) cells.set(key, { char: ch, authorId, color }); else cells.delete(key);
        draw();
      } else if (payload.type === 'cursor') {
        // Don't update our own cursor from server (we manage it locally)
        if (payload.clientId === myClientId) {
          draw();
          return;
        }
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
      } else if (payload.type === 'selection') {
        // Don't update our own selection from server
        if (payload.clientId === myClientId) {
          return;
        }
        otherSelections.set(payload.clientId, {
          startRow: payload.startRow,
          startCol: payload.startCol,
          endRow: payload.endRow,
          endCol: payload.endCol,
          color: payload.color,
          selectionMode: payload.selectionMode
        });
        draw();
      } else if (payload.type === 'selection_clear') {
        // Don't clear our own selection from server
        if (payload.clientId === myClientId) {
          return;
        }
        otherSelections.delete(payload.clientId);
        draw();
      }
    });

    socket.addEventListener('close', () => {
      setTimeout(connect, 500); // simple reconnect
    });
  }

  function safeParse(data) {
    try { return JSON.parse(data); } catch { return null; }
  }

  function sendCell(row, col, ch, cellColor = null) {
    if (!socket || socket.readyState !== 1) return;
    const colorToSend = cellColor !== null ? cellColor : myColor;
    socket.send(JSON.stringify({ type: 'cell', row, col, char: ch, color: colorToSend }));
  }

  function sendCursor(row, col) {
    if (!socket || socket.readyState !== 1) return;
    socket.send(JSON.stringify({ type: 'cursor', row, col, color: myColor }));
  }

  function sendSelection() {
    if (!socket || socket.readyState !== 1) return;
    if (selection.active) {
      const minRow = Math.min(selection.startRow, selection.endRow);
      const maxRow = Math.max(selection.startRow, selection.endRow);
      const minCol = Math.min(selection.startCol, selection.endCol);
      const maxCol = Math.max(selection.startCol, selection.endCol);
      const msg = JSON.stringify({ 
        type: 'selection', 
        startRow: selection.startRow, 
        startCol: selection.startCol,
        endRow: selection.endRow,
        endCol: selection.endCol,
        color: myColor,
        selectionMode: selectionMode
      });
      socket.send(msg);
    } else {
      // Send selection clear
      socket.send(JSON.stringify({ type: 'selection_clear' }));
    }
  }

  function key(row, col) { return `${row},${col}`; }
  function getChar(row, col) { 
    const cellData = cells.get(key(row,col));
    return cellData ? cellData.char : '';
  }
  function getCellData(row, col) {
    return cells.get(key(row, col)) || null;
  }
  function setChar(row, col, ch, skipUndo = false, restoreColor = undefined, restoreAuthorId = undefined) {
    // Round to nearest grid position for storage
    const gridRow = Math.round(row);
    const gridCol = Math.round(col);
    const k = key(gridRow, gridCol);
    
    // Get old value before changing
    const oldCellData = getCellData(gridRow, gridCol);
    const oldChar = oldCellData ? oldCellData.char : '';
    const oldColor = oldCellData ? oldCellData.color : null;
    const oldAuthorId = oldCellData ? oldCellData.authorId : null;
    const newChar = ch ? getFirstChar(ch) : '';
    
    // Record change for undo (only if not applying undo/redo and not skipping)
    if (!isApplyingUndoRedo && !skipUndo && oldChar !== newChar) {
      // Clear redo stack when making a new change
      redoStack.length = 0;
      
      // Clear any pending batch timeout
      if (undoBatchTimeout) {
        clearTimeout(undoBatchTimeout);
      }
      
      // Add to current undo batch (or create new one)
      if (undoStack.length === 0 || undoStack[undoStack.length - 1].applied) {
        // Store cursor position before this batch starts
        undoStack.push({ 
          changes: [], 
          applied: false, 
          cursorRow: cursor.row, 
          cursorCol: cursor.col 
        });
      }
      undoStack[undoStack.length - 1].changes.push({
        row: gridRow,
        col: gridCol,
        oldChar: oldChar,
        newChar: newChar,
        oldColor: oldColor || '#e6e6e6', // Ensure we always have a color (fallback for cells without color)
        newColor: myColor,
        oldAuthorId: oldAuthorId || 'unknown', // Ensure we always have an authorId
        newAuthorId: myClientId
      });
      
      // Mark batch as applied after 1 second (batches consecutive changes)
      undoBatchTimeout = setTimeout(() => {
        if (undoStack.length > 0) {
          undoStack[undoStack.length - 1].applied = true;
        }
        undoBatchTimeout = null;
      }, 1000);
      
      // Limit undo history size
      if (undoStack.length > MAX_UNDO_HISTORY) {
        undoStack.shift();
      }
    }
    
    if (newChar) {
      // Use restoreColor/restoreAuthorId if provided (for undo/redo), otherwise use current myColor
      // Check for undefined (not provided) rather than null, since null is a valid color value
      // But if restoreColor is null (from old undo records), use default color
      const colorToUse = restoreColor !== undefined 
        ? (restoreColor !== null ? restoreColor : '#e6e6e6')
        : myColor;
      const authorIdToUse = restoreAuthorId !== undefined
        ? (restoreAuthorId !== null ? restoreAuthorId : 'unknown')
        : myClientId;
      cells.set(k, { char: newChar, authorId: authorIdToUse, color: colorToUse });
      sendCell(gridRow, gridCol, newChar, colorToUse);
    } else {
      cells.delete(k);
      sendCell(gridRow, gridCol, newChar);
    }
    draw();
  }
  
  function applyUndo() {
    if (undoStack.length === 0) return;
    
    const undoBatch = undoStack.pop();
    if (!undoBatch || undoBatch.changes.length === 0) return;
    
    isApplyingUndoRedo = true;
    const redoBatch = { 
      changes: [], 
      applied: false, 
      cursorRow: cursor.row, 
      cursorCol: cursor.col 
    };
    
    // Apply undo in reverse order
    for (let i = undoBatch.changes.length - 1; i >= 0; i--) {
      const change = undoBatch.changes[i];
      const currentCellData = getCellData(change.row, change.col);
      const currentChar = currentCellData ? currentCellData.char : '';
      const currentColor = currentCellData ? currentCellData.color : null;
      const currentAuthorId = currentCellData ? currentCellData.authorId : null;
      redoBatch.changes.push({
        row: change.row,
        col: change.col,
        oldChar: currentChar,
        newChar: change.oldChar,
        oldColor: currentColor,
        newColor: change.oldColor,
        oldAuthorId: currentAuthorId,
        newAuthorId: change.oldAuthorId
      });
      // Restore the character with its original color and authorId
      // Use oldColor if it exists, otherwise fall back to default (for backward compatibility with old undo records)
      setChar(change.row, change.col, change.oldChar, true, change.oldColor, change.oldAuthorId);
    }
    
    redoStack.push(redoBatch);
    
    // Restore cursor position from before the batch
    if (undoBatch.cursorRow !== null && undoBatch.cursorCol !== null) {
      cursor.row = undoBatch.cursorRow;
      cursor.col = undoBatch.cursorCol;
      ensureCursorVisible();
      sendCursor(cursor.row, cursor.col);
    }
    
    isApplyingUndoRedo = false;
    draw();
  }
  
  function applyRedo() {
    if (redoStack.length === 0) return;
    
    const redoBatch = redoStack.pop();
    if (!redoBatch || redoBatch.changes.length === 0) return;
    
    isApplyingUndoRedo = true;
    const undoBatch = { 
      changes: [], 
      applied: false, 
      cursorRow: cursor.row, 
      cursorCol: cursor.col 
    };
    
    // Apply redo
    for (const change of redoBatch.changes) {
      const currentCellData = getCellData(change.row, change.col);
      const currentChar = currentCellData ? currentCellData.char : '';
      const currentColor = currentCellData ? currentCellData.color : null;
      const currentAuthorId = currentCellData ? currentCellData.authorId : null;
      undoBatch.changes.push({
        row: change.row,
        col: change.col,
        oldChar: currentChar,
        newChar: change.newChar,
        oldColor: currentColor,
        newColor: change.newColor,
        oldAuthorId: currentAuthorId,
        newAuthorId: change.newAuthorId
      });
      // Restore the character with its color and authorId
      setChar(change.row, change.col, change.newChar, true, change.newColor, change.newAuthorId);
    }
    
    undoStack.push(undoBatch);
    
    // Restore cursor position from redo batch
    if (redoBatch.cursorRow !== null && redoBatch.cursorCol !== null) {
      cursor.row = redoBatch.cursorRow;
      cursor.col = redoBatch.cursorCol;
      ensureCursorVisible();
      sendCursor(cursor.row, cursor.col);
    }
    
    isApplyingUndoRedo = false;
    draw();
  }

  function copySelection() {
    if (!selection.active) return;
    
    const minRow = Math.min(selection.startRow, selection.endRow);
    const maxRow = Math.max(selection.startRow, selection.endRow);
    const minCol = Math.min(selection.startCol, selection.endCol);
    const maxCol = Math.max(selection.startCol, selection.endCol);
    
    let text = '';
    for (let r = minRow; r <= maxRow; r++) {
      let line = '';
      for (let c = minCol; c <= maxCol; c++) {
        line += getChar(r, c) || ' ';
      }
      // Remove trailing spaces from each line
      line = line.replace(/\s+$/, '');
      text += line;
      if (r < maxRow) text += '\n';
    }
    
    // Copy to clipboard
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {
      });
    } else {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
      } catch (err) {
      }
      document.body.removeChild(textarea);
    }
  }

  async function pasteText() {
    let text = '';
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        text = await navigator.clipboard.readText();
      } else {
        // Fallback: try to read from a temporary textarea
        const textarea = document.createElement('textarea');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        // This won't work for security reasons, but we try
        document.execCommand('paste');
        text = textarea.value;
        document.body.removeChild(textarea);
      }
    } catch (err) {
      return;
    }
    
    if (!text) return;
    
    // Handle paste into text inputs (cell-coords-input, color-picker, etc.)
    const activeElement = document.activeElement;
    if (activeElement && (activeElement === cellCoordsInput || activeElement === colorPicker || 
        (activeElement.tagName === 'INPUT' && activeElement.type === 'text'))) {
      // Paste directly into the input field
      const input = activeElement;
      const start = input.selectionStart || 0;
      const end = input.selectionEnd || input.value.length;
      const before = input.value.substring(0, start);
      const after = input.value.substring(end);
      input.value = before + text + after;
      // Set cursor position after pasted text
      const newPos = start + text.length;
      input.setSelectionRange(newPos, newPos);
      // Trigger input event to handle any validation/processing
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    
    // Calculate how much text will fit before inserting
    const startRow = Math.round(cursor.row);
    const startCol = Math.round(cursor.col);
    let currentRow = startRow;
    let currentCol = startCol;
    
    // Use Array.from to properly iterate over Unicode characters including emojis
    const chars = Array.from(text);
    
    // In selection boundary mode, calculate how many characters will fit
    const isTypingBoundaryMode = selectionMode === 1 && selection.active;
    
    // Clear selection if active (but keep it active in typing boundary mode)
    if (selection.active && !isTypingBoundaryMode) {
      const minRow = Math.min(selection.startRow, selection.endRow);
      const maxRow = Math.max(selection.startRow, selection.endRow);
      const minCol = Math.min(selection.startCol, selection.endCol);
      const maxCol = Math.max(selection.startCol, selection.endCol);
      
      // Delete selected text
      for (let r = minRow; r <= maxRow; r++) {
        for (let c = minCol; c <= maxCol; c++) {
          setChar(r, c, '');
        }
      }
      
      // Set cursor to start of selection
      cursor.row = minRow;
      cursor.col = minCol;
      currentRow = minRow;
      currentCol = minCol;
      selection.active = false;
      sendSelection(); // Notify other clients that selection is cleared
    } else if (isTypingBoundaryMode) {
      // In typing boundary mode, constrain cursor to selection
      constrainCursorToSelection();
      currentRow = Math.round(cursor.row);
      currentCol = Math.round(cursor.col);
    }
    
    if (isTypingBoundaryMode) {
      const minRow = Math.min(selection.startRow, selection.endRow);
      const maxRow = Math.max(selection.startRow, selection.endRow);
      const minCol = Math.min(selection.startCol, selection.endCol);
      const maxCol = Math.max(selection.startCol, selection.endCol);
      
      // Calculate and insert only characters that will fit
      let insertRow = currentRow;
      let insertCol = currentCol;
      
      for (let i = 0; i < chars.length; i++) {
        const char = chars[i];
        
        if (char === '\n') {
          // Newline moves to next row
          if (insertRow < maxRow) {
            insertRow++;
            insertCol = minCol;
          } else {
            // No more rows available, stop
            break;
          }
        } else {
          // Regular character - check if it fits
          if (insertCol > maxCol) {
            // Need to wrap to next row
            if (insertRow < maxRow) {
              insertRow++;
              insertCol = minCol;
            } else {
              // No more space available, stop
              break;
            }
          }
          
          // Insert the character
          setChar(insertRow, insertCol, char);
          insertCol++;
        }
      }
      
      // Update cursor position
      currentRow = insertRow;
      currentCol = insertCol;
    } else {
      // Normal mode: insert all characters (no boundary constraints)
      for (let i = 0; i < chars.length; i++) {
        const char = chars[i];
        if (char === '\n') {
          currentRow++;
          currentCol = startCol;
        } else {
          setChar(currentRow, currentCol, char);
          currentCol++;
        }
      }
    }
    
    // Update cursor position
    cursor.row = currentRow;
    cursor.col = currentCol;
    ensureCursorVisible();
    sendCursor(cursor.row, cursor.col);
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
    
    // Update zoom level slider if it exists
    if (zoomLevelSlider) {
      zoomLevelSlider.value = zoomToSlider(zoom);
      if (zoomLevelValue) {
        zoomLevelValue.textContent = zoom.toFixed(2);
      }
    }
    
    draw();
  }

  function zoomIn(centerX = null, centerY = null) {
    // Use multiplicative zoom for consistent feel at all zoom levels
    // ZOOM_STEP is now a multiplier factor (e.g., 0.05 means 5% increase)
    const zoomFactor = 1.0 + ZOOM_STEP;
    setZoom(zoom * zoomFactor, centerX, centerY);
  }

  function zoomOut(centerX = null, centerY = null) {
    // Use multiplicative zoom for consistent feel at all zoom levels
    // ZOOM_STEP is now a multiplier factor (e.g., 0.05 means 5% decrease)
    const zoomFactor = 1.0 - ZOOM_STEP;
    setZoom(zoom * zoomFactor, centerX, centerY);
  }

  function resetZoom() {
    setZoom(1.0);
  }

  function resetZoomAndCenter() {
    // Reset zoom to 1.0 (this will update the slider via setZoom)
    setZoom(1.0);
    
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

  function screenToGrid(clientX, clientY) {
    ensureCellDimensions();
    if (CELL_W === 0) CELL_W = 20;
    if (CELL_H === 0) CELL_H = 31;
    
    const rect = canvas.getBoundingClientRect();
    const x = clamp(clientX - rect.left, 0, rect.width - 1);
    const y = clamp(clientY - rect.top, 0, rect.height - 1);
    
    const rawCol = origin.col + x / (CELL_W * zoom);
    const rawRow = origin.row + y / (CELL_H * zoom);
    
    return {
      col: Math.floor(rawCol),
      row: Math.floor(rawRow)
    };
  }

  function gridClickToCaret(e) {
    const clientX = (e.clientX !== undefined ? e.clientX : e.x) || 0;
    const clientY = (e.clientY !== undefined ? e.clientY : e.y) || 0;
    const gridPos = screenToGrid(clientX, clientY);
    
    cursor.col = gridPos.col;
    cursor.row = gridPos.row;
    
    sendCursor(cursor.row, cursor.col);
    draw();
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
  
  function ensureCellDimensions() {
    // Ensure cell dimensions are never 0
    if (CELL_W === 0) {
      CELL_W = getApproxCharWidth();
    }
    if (CELL_H === 0) {
      CELL_H = getLineHeightPx();
    }
  }

  // Helper function to get first Unicode character (handles emojis correctly)
  function getFirstChar(str) {
    if (!str || str.length === 0) return '';
    // Use Array.from to properly handle Unicode characters including emojis
    const chars = Array.from(str);
    return chars[0] || '';
  }

  // Helper to detect if a character is an emoji
  function isEmoji(char) {
    if (!char) return false;
    const codePoint = char.codePointAt(0);
    // Check major emoji ranges
    return (
      (codePoint >= 0x1F300 && codePoint <= 0x1F9FF) || // Miscellaneous Symbols and Pictographs
      (codePoint >= 0x1F600 && codePoint <= 0x1F64F) || // Emoticons
      (codePoint >= 0x1F680 && codePoint <= 0x1F6FF) || // Transport and Map Symbols
      (codePoint >= 0x2600 && codePoint <= 0x26FF) ||   // Miscellaneous Symbols
      (codePoint >= 0x2700 && codePoint <= 0x27BF) ||   // Dingbats
      (codePoint >= 0xFE00 && codePoint <= 0xFE0F) ||   // Variation Selectors
      (codePoint >= 0x1F900 && codePoint <= 0x1F9FF) || // Supplemental Symbols and Pictographs
      (codePoint >= 0x1F1E0 && codePoint <= 0x1F1FF) || // Regional Indicator Symbols (flags)
      (codePoint >= 0x2B00 && codePoint <= 0x2BFF) ||   // Miscellaneous Symbols and Arrows (includes geometric shapes like ⬜)
      (codePoint >= 0x25A0 && codePoint <= 0x25FF)      // Geometric Shapes
    );
  }

  // Helper to detect large emojis that need extra small sizing (geometric shapes, etc.)
  function isLargeEmoji(char) {
    if (!char) return false;
    const codePoint = char.codePointAt(0);
    // Geometric shapes and large symbols that render bigger
    return (
      (codePoint >= 0x2B00 && codePoint <= 0x2BFF) ||   // Miscellaneous Symbols and Arrows (squares, circles, etc.)
      (codePoint >= 0x25A0 && codePoint <= 0x25FF)      // Geometric Shapes
    );
  }

  function getFontSpec(char = null) {
    // Use even smaller font size for large emojis (16px), regular emojis (20px), or normal text (28px)
    let fontSize = '28px';
    const isEmojiChar = char && isEmoji(char);
    const isLargeEmojiChar = char && isLargeEmoji(char);
    
    if (char) {
      if (isLargeEmojiChar) {
        fontSize = '16px'; // Extra small for large geometric shapes
      } else if (isEmojiChar) {
        fontSize = '20px'; // Small for regular emojis
      }
    }
    
    // For emojis, include emoji fonts first so they're preferred
    // For regular text (numbers, letters, symbols), use only monospace fonts to avoid rendering issues
    if (isEmojiChar) {
      return `${fontSize} "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "EmojiOne Color", "Android Emoji", "Twemoji Mozilla", emoji, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
    } else {
      // Regular text: use only monospace fonts to ensure consistent rendering across browsers
      return `${fontSize} ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
    }
  }

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    // Use document.documentElement dimensions for consistency across devices
    const w = Math.floor(document.documentElement.clientWidth);
    const h = Math.floor(document.documentElement.clientHeight);
    
    // Allow initial canvas setup to proceed normally
    
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    CELL_W = Math.round(getApproxCharWidth());
    CELL_H = Math.round(getLineHeightPx());
    
    // Don't reset cursor position on resize - preserve user's cursor position
    
    // Only center the view on (0,0) during initial setup, not on every resize
    if (!canvasInitialized && w > 0 && h > 0 && CELL_W > 0 && CELL_H > 0) {
      // Center the view on the cursor at (0,0) during initial setup
      // This makes the cursor appear in the center of the viewport
      // Use the dimensions we just set (w and h) since canvas.clientWidth might not be updated yet
      origin.col = -Math.floor(w / (CELL_W * zoom) / 2);
      origin.row = -Math.floor(h / (CELL_H * zoom) / 2);
    }
    // During resize, keep the current origin to prevent grid jumping
    
    draw();
  }

  window.addEventListener('resize', resizeCanvas);
  
  
  // Ensure canvas is fully rendered before initial positioning
  // Use a flag to prevent race conditions with user interactions
  let canvasInitialized = false;
  // Use requestAnimationFrame to ensure canvas is fully ready
  requestAnimationFrame(() => {
    setTimeout(() => {
      resizeCanvas();
      canvasInitialized = true;
    }, 0);
  });

  let drawScheduled = false;
  function draw() {
    if (drawScheduled) return;
    drawScheduled = true;
    requestAnimationFrame(() => {
      drawScheduled = false;
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
    // Draw selection highlight (background) before rendering text
    if (selection.active) {
      const minRow = Math.min(selection.startRow, selection.endRow);
      const maxRow = Math.max(selection.startRow, selection.endRow);
      const minCol = Math.min(selection.startCol, selection.endCol);
      const maxCol = Math.max(selection.startCol, selection.endCol);
      
      const relC = minCol - origin.col;
      const relR = minRow - origin.row;
      const x = relC * CELL_W;
      const y = relR * CELL_H;
      const width = (maxCol - minCol + 1) * CELL_W;
      const height = (maxRow - minRow + 1) * CELL_H;
      
      // Convert hex color to rgba with opacity
      const hex = myColor.replace('#', '');
      const colorR = parseInt(hex.substring(0, 2), 16);
      const colorG = parseInt(hex.substring(2, 4), 16);
      const colorB = parseInt(hex.substring(4, 6), 16);
      
      if (selectionMode === 1) {
        // In typing boundary mode, draw outline using author color
        ctx.strokeStyle = `rgba(${colorR}, ${colorG}, ${colorB}, 0.8)`;
        ctx.lineWidth = 2 / zoom;
        ctx.strokeRect(x, y, width, height);
      } else {
        // Normal mode: draw filled highlight using author color
        ctx.fillStyle = `rgba(${colorR}, ${colorG}, ${colorB}, 0.3)`;
        for (let row = minRow; row <= maxRow; row++) {
          for (let col = minCol; col <= maxCol; col++) {
            const relCPos = col - origin.col;
            const relRPos = row - origin.row;
            const cellX = relCPos * CELL_W;
            const cellY = relRPos * CELL_H;
            if (cellX + CELL_W < 0 || cellY + CELL_H < 0 || cellX > w / zoom || cellY > h / zoom) continue;
            ctx.fillRect(cellX, cellY, CELL_W, CELL_H);
          }
        }
      }
    }
    
    // Draw other users' selections behind text as well
    for (const [clientId, otherSelection] of otherSelections) {
      const minRow = Math.min(otherSelection.startRow, otherSelection.endRow);
      const maxRow = Math.max(otherSelection.startRow, otherSelection.endRow);
      const minCol = Math.min(otherSelection.startCol, otherSelection.endCol);
      const maxCol = Math.max(otherSelection.startCol, otherSelection.endCol);
      
      const relC = minCol - origin.col;
      const relR = minRow - origin.row;
      const x = relC * CELL_W;
      const y = relR * CELL_H;
      const width = (maxCol - minCol + 1) * CELL_W;
      const height = (maxRow - minRow + 1) * CELL_H;
      
      // Convert hex color to rgba with opacity
      const hex = otherSelection.color.replace('#', '');
      const colorR = parseInt(hex.substring(0, 2), 16);
      const colorG = parseInt(hex.substring(2, 4), 16);
      const colorB = parseInt(hex.substring(4, 6), 16);
      
      if (otherSelection.selectionMode === 1) {
        // In typing boundary mode, draw outline using author color
        ctx.strokeStyle = `rgba(${colorR}, ${colorG}, ${colorB}, 0.8)`;
        ctx.lineWidth = 2 / zoom;
        ctx.strokeRect(x, y, width, height);
      } else {
        // Normal mode: draw filled highlight using author color
        ctx.fillStyle = `rgba(${colorR}, ${colorG}, ${colorB}, 0.3)`;
        for (let row = minRow; row <= maxRow; row++) {
          for (let col = minCol; col <= maxCol; col++) {
            const relCPos = col - origin.col;
            const relRPos = row - origin.row;
            const cellX = relCPos * CELL_W;
            const cellY = relRPos * CELL_H;
            if (cellX + CELL_W < 0 || cellY + CELL_H < 0 || cellX > w / zoom || cellY > h / zoom) continue;
            ctx.fillRect(cellX, cellY, CELL_W, CELL_H);
          }
        }
      }
    }
    
    // text - render with colors based on who typed it
    ctx.textBaseline = 'top';
    for (const [k, cellData] of cells) {
      const [r, c] = k.split(',').map(Number);
      const relC = c - origin.col;
      const relR = r - origin.row;
      const x = relC * CELL_W;
      const y = relR * CELL_H;
      if (x + CELL_W < 0 || y + CELL_H < 0 || x > w / zoom || y > h / zoom) continue;
      
      // Set font based on character (smaller for emojis)
      ctx.font = getFontSpec(cellData.char);
      
      // Use the stored color for this character and brighten if it's in our active selection
      let cellColor = cellData.color || '#e6e6e6';
      if (selectionMode !== 2 && selection.active && isCellWithinSelection(r, c)) {
        cellColor = lightenColor(cellColor, 0.35);
      }
      ctx.fillStyle = cellColor;
      
      // Center alignment with small adjustment for emojis
      const isEmojiChar = isEmoji(cellData.char);
      const isLargeEmojiChar = isLargeEmoji(cellData.char);
      // Large emojis need more offset, regular emojis need less
      const offsetX = isLargeEmojiChar ? 2.5 : (isEmojiChar ? 1.5 : 0);
      const textX = x + CELL_W / 2 + offsetX;
      
      // Use alphabetic baseline alignment - like writing on a line
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      // Position baseline at a consistent height in the cell (about 75% down from top)
      // This creates a natural writing line where all characters sit
      const isNumber = /[0-9]/.test(cellData.char);
      const isLetter = /[a-zA-Z]/.test(cellData.char);
      // Different offsets: letters 4px, numbers 4px (to match letters in Safari/WebKit), symbols 2px
      let offset = 0;
      if (isLetter || isNumber) {
        offset = 4; // Numbers and letters get same offset for consistent alignment
      } else {
        offset = 2; // Symbols (anything that's not a letter or number)
      }
      const textY = y + CELL_H * 0.75 + offset;
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
    
    // my cursor as full-cell highlight - use my color (only if not selecting)
    if (!isSelecting) {
    ctx.fillStyle = myColor + '40'; // add transparency
      // Calculate cursor position relative to viewport - ensure integer positions for consistent rendering
      const curCol = Math.round(cursor.col);
      const curRow = Math.round(cursor.row);
      const curX = (curCol - origin.col) * CELL_W;
      const curY = (curRow - origin.row) * CELL_H;
      
      
    // Only draw if cursor is visible in viewport
    if (curX >= -CELL_W && curX <= w / zoom && curY >= -CELL_H && curY <= h / zoom) {
      ctx.fillRect(curX, curY, CELL_W, CELL_H);
      }
    }
    
    // Update cell coordinates input (when not focused)
    if (cellCoordsInput && document.activeElement !== cellCoordsInput) {
      cellCoordsInput.value = formatCursorCoords();
    }
    
    // Restore transformation
    ctx.restore();
    });
  }

  function updateGridMetrics() {
    CELL_W = Math.round(getApproxCharWidth());
    CELL_H = Math.round(getLineHeightPx());
    wall.style.setProperty('--cellW', `${CELL_W}px`);
    wall.style.setProperty('--cellH', `${CELL_H}px`);
  }

  window.addEventListener('resize', updateGridMetrics);
  updateGridMetrics();

  function handleMouseDown(e) {
    if (e.button !== 0) return; // left click only (middle/right mouse handled separately)
    
      // In pan mode, handle panning instead of selection
      if (selectionMode === 2) {
      const initialMouse = { x: e.clientX, y: e.clientY, time: Date.now() };
      isDragging = true;
      dragStart.x = e.clientX;
      dragStart.y = e.clientY;
      dragStart.originRow = origin.row;
      dragStart.originCol = origin.col;
      
      // Set up mousemove handler for pan mode drag
      const handlePanMouseMove = (moveEvent) => {
        if (!isDragging) {
          document.removeEventListener('mousemove', handlePanMouseMove);
          return;
        }
        const dx = moveEvent.clientX - dragStart.x;
        const dy = moveEvent.clientY - dragStart.y;
        origin.col = dragStart.originCol - dx / (CELL_W * zoom);
        origin.row = dragStart.originRow - dy / (CELL_H * zoom);
        draw();
      };
      
      // Set up mouseup handler to detect clicks in pan mode
      const handlePanMouseUp = (upEvent) => {
        const dx = Math.abs(upEvent.clientX - initialMouse.x);
        const dy = Math.abs(upEvent.clientY - initialMouse.y);
        const dt = Date.now() - initialMouse.time;
        const wasClick = dx < 5 && dy < 5 && dt < 300;
        
        // If it's a click (small movement, short duration), place cursor
        if (wasClick) {
          try {
            canvas.focus();
            const gridPos = screenToGrid(upEvent.clientX, upEvent.clientY);
            selection.active = false;
            sendSelection();
            gridClickToCaret(upEvent);
          } catch (error) {
            // Silently handle errors
          }
        }
        
        isDragging = false;
        document.removeEventListener('mousemove', handlePanMouseMove);
        canvas.removeEventListener('mouseup', handlePanMouseUp);
      };
      
      document.addEventListener('mousemove', handlePanMouseMove);
      canvas.addEventListener('mouseup', handlePanMouseUp);
      e.preventDefault();
      return;
    }
    
    // Check if Shift is held for selection
    if (e.shiftKey && selection.active) {
      // Extend selection
      isSelecting = true;
      const gridPos = screenToGrid(e.clientX, e.clientY);
      selection.endRow = gridPos.row;
      selection.endCol = gridPos.col;
      sendSelection(); // Send initial state immediately
      draw();
      
      let lastShiftSelectionEndRow = selection.endRow;
      let lastShiftSelectionEndCol = selection.endCol;
      let lastShiftSelectionSend = Date.now();
      const handleMouseMove = (moveEvent) => {
        const gridPos = screenToGrid(moveEvent.clientX, moveEvent.clientY);
        selection.endRow = gridPos.row;
        selection.endCol = gridPos.col;
        
        // Only send if selection end position actually changed
        const endChanged = selection.endRow !== lastShiftSelectionEndRow || selection.endCol !== lastShiftSelectionEndCol;
        
        // Send update if position changed and enough time has passed (throttle to 30ms)
        if (endChanged) {
          const now = Date.now();
          if (now - lastShiftSelectionSend > 30) {
            sendSelection();
            lastShiftSelectionSend = now;
            lastShiftSelectionEndRow = selection.endRow;
            lastShiftSelectionEndCol = selection.endCol;
          }
        }
        draw();
      };
      
      const handleMouseUp = () => {
        isSelecting = false;
        sendSelection(); // Send final selection state
        canvas.removeEventListener('mousemove', handleMouseMove);
        canvas.removeEventListener('mouseup', handleMouseUp);
      };
      
      canvas.addEventListener('mousemove', handleMouseMove);
      canvas.addEventListener('mouseup', handleMouseUp);
      e.preventDefault();
      return;
    }
    
    // Store initial mouse position for drag detection
    const initialMouse = { x: e.clientX, y: e.clientY, time: Date.now() };
    const initialGridPos = screenToGrid(e.clientX, e.clientY);
    
    // Set up drag detection
    const handleMouseMove = (moveEvent) => {
      // If we're already selecting, don't process this
      if (isSelecting) {
        return;
      }
      
      const dx = Math.abs(moveEvent.clientX - initialMouse.x);
      const dy = Math.abs(moveEvent.clientY - initialMouse.y);
      
      // If moved more than 5 pixels, start selection or dragging
      if (dx > 5 || dy > 5) {
        // In pan mode, don't create selection
        if (selectionMode === 2) {
          isDragging = true;
          dragStart.x = initialMouse.x;
          dragStart.y = initialMouse.y;
          dragStart.originRow = origin.row;
          dragStart.originCol = origin.col;
          // Remove this handler and let pan mode handle it
          canvas.removeEventListener('mousemove', handleMouseMove);
          return;
        }
        
        // Start selection (only in selection modes 0 or 1)
        isSelecting = true;
        selection.active = true;
        selection.startRow = initialGridPos.row;
        selection.startCol = initialGridPos.col;
        selection.endRow = initialGridPos.row;
        selection.endCol = initialGridPos.col;
        
        // Send initial selection
        sendSelection();
        
        // Set cursor to top-left of selection (will be updated as selection changes)
        const updateCursorToTopLeft = () => {
          const minRow = Math.min(selection.startRow, selection.endRow);
          const minCol = Math.min(selection.startCol, selection.endCol);
          cursor.row = minRow;
          cursor.col = minCol;
          // Don't call ensureCursorVisible during selection - it causes rendering issues
          sendCursor(cursor.row, cursor.col);
        };
        
        // Set initial cursor position
        updateCursorToTopLeft();
        
        let lastSelectionEndRow = selection.endRow;
        let lastSelectionEndCol = selection.endCol;
        let lastSelectionSend = Date.now();
        const handleSelectionMove = (moveEvent2) => {
          const gridPos = screenToGrid(moveEvent2.clientX, moveEvent2.clientY);
          selection.endRow = gridPos.row;
          selection.endCol = gridPos.col;
          
          // Only send if selection end position actually changed
          const endChanged = selection.endRow !== lastSelectionEndRow || selection.endCol !== lastSelectionEndCol;
          
          // Always keep cursor at top-left of selection
          updateCursorToTopLeft();
          
          // Send update if position changed and enough time has passed (throttle to 30ms)
          if (endChanged) {
            const now = Date.now();
            if (now - lastSelectionSend > 30) {
              sendSelection();
              lastSelectionSend = now;
              lastSelectionEndRow = selection.endRow;
              lastSelectionEndCol = selection.endCol;
            }
          }
          draw();
        };
        
        const handleSelectionUp = (upEvent) => {
          isSelecting = false;
          canvas.removeEventListener('mousemove', handleSelectionMove);
          canvas.removeEventListener('mouseup', handleSelectionUp);
          
          // Update selection end position to current mouse position (important for fast selections)
          if (selection.active && upEvent) {
            const gridPos = screenToGrid(upEvent.clientX, upEvent.clientY);
            selection.endRow = gridPos.row;
            selection.endCol = gridPos.col;
          }
          
          // Set cursor to top-left of selection when selection is created
          if (selection.active) {
            const minRow = Math.min(selection.startRow, selection.endRow);
            const minCol = Math.min(selection.startCol, selection.endCol);
            cursor.row = minRow;
            cursor.col = minCol;
            // Don't call ensureCursorVisible during selection - it causes rendering issues
            sendCursor(cursor.row, cursor.col);
            // Always send final selection state immediately, even if selection was very fast
            sendSelection();
            draw();
          }
        };
        
        canvas.removeEventListener('mousemove', handleMouseMove);
        canvas.removeEventListener('mouseup', handleMouseUp);
        canvas.addEventListener('mousemove', handleSelectionMove);
        canvas.addEventListener('mouseup', handleSelectionUp);
        draw();
      }
    };
    
    const handleMouseUp = (upEvent) => {
      const dx = Math.abs(upEvent.clientX - initialMouse.x);
      const dy = Math.abs(upEvent.clientY - initialMouse.y);
      const dt = Date.now() - initialMouse.time;
      
      // If it's a click (small movement, short duration), place cursor
      if (dx < 5 && dy < 5 && dt < 300) {
        // In pan mode, still allow clicks to place cursor (but dragging pans)
        canvas.focus();
        const gridPos = screenToGrid(upEvent.clientX, upEvent.clientY);
        
        // In typing boundary mode, check if click is inside selection
        if (selectionMode === 1 && selection.active) {
          const minRow = Math.min(selection.startRow, selection.endRow);
          const maxRow = Math.max(selection.startRow, selection.endRow);
          const minCol = Math.min(selection.startCol, selection.endCol);
          const maxCol = Math.max(selection.startCol, selection.endCol);
          
          // Check if click is inside selection bounds
          if (gridPos.row >= minRow && gridPos.row <= maxRow &&
              gridPos.col >= minCol && gridPos.col <= maxCol) {
            // Click is inside selection - move cursor but keep selection
            cursor.row = gridPos.row;
            cursor.col = gridPos.col;
            ensureCursorVisible();
            sendCursor(cursor.row, cursor.col);
            draw();
          } else {
            // Click is outside selection - clear selection and place cursor normally
            selection.active = false;
            sendSelection();
            gridClickToCaret(upEvent);
          }
        } else {
          // Normal mode: clear selection and place cursor
          selection.active = false;
          sendSelection();
          gridClickToCaret(upEvent);
        }
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
    // Don't handle touch events if they're on color picker elements
    const colorPickerContainer = document.getElementById('color-picker-container');
    if (colorPickerContainer && e.target && colorPickerContainer.contains(e.target)) {
      e.preventDefault(); // Prevent page scrolling
      return; // Let the color picker handle its own touch events
    }
    
    const touches = e.touches;
    if (!touches || touches.length === 0) return;
    
    // Check selection mode once at the top
    const isSelectionMode = selectionMode === 0 || selectionMode === 1;
    const isPanMode = selectionMode === 2;
    
    // Update active touches map
    for (let i = 0; i < touches.length; i++) {
      const touch = touches[i];
      activeTouches.set(touch.identifier, {
        clientX: touch.clientX,
        clientY: touch.clientY,
        startTime: Date.now()
      });
    }
    
    // Handle pinch gesture (two fingers) - now enabled in all modes
    // Two fingers = pan/zoom, single finger = normal behavior (selection or pan depending on mode)
    
    if (touches.length === 2) {
      // Track if we were previously dragging
      wasDraggingBeforePinch = isTouchDragging;
      
      isPinching = true;
      isTouchDragging = false;
      
      // Cancel any active selection when two fingers are detected
      if (isSelecting) {
        isSelecting = false;
      }
      
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
    const initialGridPos = screenToGrid(t.clientX, t.clientY);
    
    // Ensure touch reference points are properly synchronized with current view state
    touchStart.x = t.clientX;
    touchStart.y = t.clientY;
    touchStart.originRow = origin.row;
    touchStart.originCol = origin.col;
    touchStart.time = Date.now();
    isTouchDragging = false;
    
    // Set up touch move handler for selection
    let touchMoveHandler = null;
    let lastSelectionSendTime = 0;
    if (isSelectionMode) {
      touchMoveHandler = (moveEvent) => {
        // Don't handle selection if two fingers are active (multi-touch pan/zoom)
        if (moveEvent.touches && moveEvent.touches.length >= 2) {
          return;
        }
        // Also check activeTouches to be safe
        if (activeTouches.size >= 2 || isPinching) {
          return;
        }
        
        const moveTouch = moveEvent.touches && moveEvent.touches[0];
        if (!moveTouch) return;
        
        const dx = Math.abs(moveTouch.clientX - initialTouch.x);
        const dy = Math.abs(moveTouch.clientY - initialTouch.y);
        
        // If moved more than 5 pixels, start selection
        if (dx > 5 || dy > 5) {
          if (!isSelecting) {
            isSelecting = true;
            selection.active = true;
            selection.startRow = initialGridPos.row;
            selection.startCol = initialGridPos.col;
            selection.endRow = initialGridPos.row;
            selection.endCol = initialGridPos.col;
            
            // Send initial selection
            sendSelection();
            lastSelectionSendTime = Date.now();
            
            // Set cursor to top-left of selection (will be updated as selection changes)
            const minRow = Math.min(selection.startRow, selection.endRow);
            const minCol = Math.min(selection.startCol, selection.endCol);
            cursor.row = minRow;
            cursor.col = minCol;
            // Don't call ensureCursorVisible during selection - it causes rendering issues on mobile
            sendCursor(cursor.row, cursor.col);
          }
          
          const gridPos = screenToGrid(moveTouch.clientX, moveTouch.clientY);
          const oldEndRow = selection.endRow;
          const oldEndCol = selection.endCol;
          selection.endRow = gridPos.row;
          selection.endCol = gridPos.col;
          
          // Only send if selection end position actually changed
          const endChanged = selection.endRow !== oldEndRow || selection.endCol !== oldEndCol;
          
          // Always keep cursor at top-left of selection
          const minRow = Math.min(selection.startRow, selection.endRow);
          const minCol = Math.min(selection.startCol, selection.endCol);
          const oldCursorRow = cursor.row;
          const oldCursorCol = cursor.col;
          cursor.row = minRow;
          cursor.col = minCol;
          
          // Only send cursor update if cursor position changed
          // Don't call ensureCursorVisible during selection - it causes rendering issues on mobile
          if (cursor.row !== oldCursorRow || cursor.col !== oldCursorCol) {
            sendCursor(cursor.row, cursor.col);
          }
          
          // Send selection update if position changed and enough time has passed (throttle to 30ms)
          if (endChanged) {
            const now = Date.now();
            if (now - lastSelectionSendTime > 30) {
              sendSelection();
              lastSelectionSendTime = now;
            }
          }
          
          draw();
        }
      };
      window.addEventListener('touchmove', touchMoveHandler, { passive: false });
    }
    
    // Set up touch end handler
    const handleTouchEnd = (endEvent) => {
      const endTouch = endEvent.changedTouches && endEvent.changedTouches[0];
      if (!endTouch) return;
      
      const dx = Math.abs(endTouch.clientX - initialTouch.x);
      const dy = Math.abs(endTouch.clientY - initialTouch.y);
      const dt = Date.now() - initialTouch.time;
      
      // Remove touch move handler if it was added
      if (touchMoveHandler) {
        window.removeEventListener('touchmove', touchMoveHandler);
        touchMoveHandler = null;
      }
      
      // If we were selecting, finalize selection regardless of drag distance
      if (isSelecting && selection.active) {
        isSelecting = false;
        
        // Update selection end position to current touch position (important for fast selections)
        const gridPos = screenToGrid(endTouch.clientX, endTouch.clientY);
        selection.endRow = gridPos.row;
        selection.endCol = gridPos.col;
        
        // Set cursor to top-left of selection (for both normal and typing boundary mode)
        const minRow = Math.min(selection.startRow, selection.endRow);
        const minCol = Math.min(selection.startCol, selection.endCol);
        cursor.row = minRow;
        cursor.col = minCol;
        // Don't call ensureCursorVisible during selection end - it causes rendering issues on mobile
        sendCursor(cursor.row, cursor.col);
        sendSelection(); // Send final selection state
        draw();
        
        canvas.removeEventListener('touchend', handleTouchEnd);
        return;
      }
      
      // If it's a tap (small movement, short duration) and not a drag, focus input and place cursor
      if (dx < 10 && dy < 10 && dt < 300 && !isTouchDragging && !isPinching) {
        // In pan mode, still allow taps to place cursor (but dragging pans)
        // Just continue to the cursor placement code below
        
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
            // Store the touch coordinates before any potential viewport changes
            const touchCoords = { clientX: t.clientX, clientY: t.clientY };
            
            mobileInput.focus();
            
            // Place cursor at tap location
            const placeCursor = () => {
              const fakeEvent = { clientX: touchCoords.clientX, clientY: touchCoords.clientY };
              const gridPos = screenToGrid(fakeEvent.clientX, fakeEvent.clientY);
              
              // In typing boundary mode, check if tap is inside selection
              if (selectionMode === 1 && selection.active) {
                const minRow = Math.min(selection.startRow, selection.endRow);
                const maxRow = Math.max(selection.startRow, selection.endRow);
                const minCol = Math.min(selection.startCol, selection.endCol);
                const maxCol = Math.max(selection.startCol, selection.endCol);
                
                // Check if tap is inside selection bounds
                if (gridPos.row >= minRow && gridPos.row <= maxRow &&
                    gridPos.col >= minCol && gridPos.col <= maxCol) {
                  // Tap is inside selection - move cursor to tap location but keep selection
                  cursor.row = gridPos.row;
                  cursor.col = gridPos.col;
                  ensureCursorVisible();
                  sendCursor(cursor.row, cursor.col);
                  draw();
                } else {
                  // Tap is outside selection - clear selection and place cursor normally
                  selection.active = false;
                  sendSelection();
                  gridClickToCaret(fakeEvent);
                }
        } else {
          // Normal mode: clear selection and place cursor at tap location
          selection.active = false;
          sendSelection();
          gridClickToCaret(fakeEvent);
        }
            };
            
            // Wait for canvas initialization if it hasn't happened yet
            if (canvasInitialized) {
              setTimeout(placeCursor, 10);
            } else {
              // Wait for canvas initialization, then place cursor
              const checkInitialization = () => {
                if (canvasInitialized) {
                  setTimeout(placeCursor, 10);
                } else {
                  setTimeout(checkInitialization, 5);
                }
              };
              checkInitialization();
            }
          }
          
          // Store tap info for double-tap detection
          lastTapTime = currentTime;
          lastTapPosition = currentPosition;
        }
      }
      
      // Clean up
      isSelecting = false;
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

  // Mobile input handling - completely rewritten for Chrome Android
  const mobileInput = document.getElementById('mobile-input');
  if (mobileInput) {
    let lastInputValue = '';
    let isProcessingInput = false; // Flag to prevent re-entrancy
    
    mobileInput.addEventListener('input', (e) => {
      if (isProcessingInput) {
        return;
      }
      
      const value = e.target.value;
      const valueLength = value.length;
      const lastLength = lastInputValue.length;
      
      isProcessingInput = true;
      
      try {
        // Handle backspace (value got shorter)
        if (valueLength < lastLength) {
          
          // In typing boundary mode, handle backspace within selection bounds
          if (selectionMode === 1 && selection.active) {
            // Constrain cursor to selection bounds
            constrainCursorToSelection();
            cursor.row = Math.round(cursor.row);
            cursor.col = Math.round(cursor.col);
            
            // Move cursor left (wrapping if needed)
            moveCursorLeftInSelection();
            cursor.row = Math.round(cursor.row);
            cursor.col = Math.round(cursor.col);
            
            // Delete character at new cursor position
            setChar(cursor.row, cursor.col, '');
            
            ensureCursorVisible();
            sendCursor(cursor.row, cursor.col);
            draw();
            
            e.target.value = '';
            lastInputValue = '';
            return;
          }
          
          // If there's an active selection, delete it (normal mode)
          if (selection.active) {
            const minRow = Math.min(selection.startRow, selection.endRow);
            const maxRow = Math.max(selection.startRow, selection.endRow);
            const minCol = Math.min(selection.startCol, selection.endCol);
            const maxCol = Math.max(selection.startCol, selection.endCol);
            
            // Delete selected text
            for (let r = minRow; r <= maxRow; r++) {
              for (let c = minCol; c <= maxCol; c++) {
                setChar(r, c, '');
              }
            }
            
            // Set cursor to start of selection
            cursor.row = minRow;
            cursor.col = minCol;
            selection.active = false;
            sendSelection(); // Notify other clients that selection is cleared
            ensureCursorVisible();
            sendCursor(cursor.row, cursor.col);
            draw();
            
            e.target.value = '';
            lastInputValue = '';
            return;
          }
          
        cursor.row = Math.round(cursor.row);
        cursor.col = Math.round(cursor.col);
          cursor.col -= 1;
          setChar(cursor.row, cursor.col, '');
        ensureCursorVisible();
        sendCursor(cursor.row, cursor.col);
        draw();
        
        e.target.value = '';
        lastInputValue = '';
        }
        // Handle new character (value got longer)
        else if (valueLength > lastLength) {
          // Use Array.from to properly extract Unicode characters including emojis
          const chars = Array.from(value);
          
          // Detect if this is a paste (multiple characters added at once)
          const isPaste = valueLength > lastLength + 1;
          
          // Get the new characters (everything after the last known value)
          const newChars = isPaste ? chars.slice(lastLength) : [chars[chars.length - 1]];
          
          // Check for secret debug sequence (only check last character for single char input)
          if (!isPaste) {
            const newChar = newChars[0];
            debugKeySequence += newChar.toLowerCase();
            if (debugKeySequence.length > DEBUG_SEQUENCE.length) {
              debugKeySequence = debugKeySequence.slice(-DEBUG_SEQUENCE.length);
            }
            
            if (debugKeySequence === DEBUG_SEQUENCE) {
              toggleDebugMenu();
              debugKeySequence = '';
              e.target.value = '';
              lastInputValue = '';
              isProcessingInput = false;
              return;
            }
            
            trackKeyPress(newChar, 'Character', e);
          }
          
          // In typing boundary mode, keep selection and constrain cursor
          if (selectionMode === 1 && selection.active) {
            // Constrain cursor to selection bounds
            constrainCursorToSelection();
            cursor.row = Math.round(cursor.row);
            cursor.col = Math.round(cursor.col);
            
            // Process all new characters
            for (let i = 0; i < newChars.length; i++) {
              const char = newChars[i];
              
              // Handle newlines in paste
              if (char === '\n') {
                // Move to next row, wrapping if needed
                cursor.row++;
                const minCol = Math.min(selection.startCol, selection.endCol);
                cursor.col = minCol;
                
                // If past bottom, wrap to top
                const maxRow = Math.max(selection.startRow, selection.endRow);
                if (cursor.row > maxRow) {
                  cursor.row = Math.min(selection.startRow, selection.endRow);
                  cursor.col = minCol;
                }
              } else {
                // Set character at current position
                setChar(cursor.row, cursor.col, char);
                
                // Move cursor right, wrapping if needed
                cursor.col += 1;
                wrapCursorInSelection();
              }
            }
            
            ensureCursorVisible();
            sendCursor(cursor.row, cursor.col);
            draw();
            
            e.target.value = '';
            lastInputValue = '';
            isProcessingInput = false;
            return;
          }
          
          // Normal mode: Move cursor to selection start when typing
          if (selection.active) {
            moveCursorToSelectionStart();
            selection.active = false;
            sendSelection(); // Notify other clients that selection is cleared
          }
          
          // Process all new characters
          let currentRow = Math.round(cursor.row);
          let currentCol = Math.round(cursor.col);
          
          for (let i = 0; i < newChars.length; i++) {
            const char = newChars[i];
            
            // Handle newlines in paste
            if (char === '\n') {
              // Move to next row, start at column 0 (or wrap around)
              currentRow++;
              currentCol = 0;
            } else {
              // Set character at current position
              setChar(currentRow, currentCol, char);
              
              // Move cursor right (no wrapping in normal mode - just continues)
              currentCol += 1;
            }
          }
          
          // Update cursor position
          cursor.row = currentRow;
          cursor.col = currentCol;
          
          ensureCursorVisible();
          sendCursor(cursor.row, cursor.col);
          draw();
          
          e.target.value = '';
          lastInputValue = '';
        }
        // Value unchanged - just clear it
        else {
          e.target.value = '';
          lastInputValue = '';
        }
      } finally {
        isProcessingInput = false;
      }
    });

    // Add composition event listeners to track IME/composition input
    mobileInput.addEventListener('compositionstart', (e) => {
      isComposing = true;
      // Track the initial composition value
      lastCompositionValue = e.target.value || '';
      
      // Update debug info to show composition started
      if (debugMenuVisible) {
        const lastKeyEl = document.getElementById('last-key');
        const keyCodeEl = document.getElementById('key-code');
        const rawKeyCodeEl = document.getElementById('raw-keycode');
        const keyEventTypeEl = document.getElementById('key-event-type');
        
        if (lastKeyEl) lastKeyEl.textContent = 'Composition Start';
        if (keyCodeEl) keyCodeEl.textContent = 'compositionstart';
        if (rawKeyCodeEl) rawKeyCodeEl.textContent = '229';
        if (keyEventTypeEl) keyEventTypeEl.textContent = 'compositionstart';
        
        updateDebugInfo();
      }
    });

    mobileInput.addEventListener('compositionupdate', (e) => {
      // Track the composition value as it changes
      lastCompositionValue = e.data || '';
    });

    mobileInput.addEventListener('compositionend', (e) => {
      isComposing = false;
      
      // Process any characters that were composed
      const value = e.target.value;
      if (value && value.length > 0) {
        // In pan mode, don't allow typing
        if (selectionMode === 2) {
          e.target.value = '';
          lastInputValue = '';
          lastCompositionValue = '';
          return;
        }
        
        // Process the composed text
        // Use Array.from to properly iterate over Unicode characters including emojis
        const chars = Array.from(value);
        for (let i = 0; i < chars.length; i++) {
          const char = chars[i];
          
          // In typing boundary mode, keep selection and constrain cursor
          if (selectionMode === 1 && selection.active) {
            // Constrain cursor to selection bounds
            constrainCursorToSelection();
            cursor.row = Math.round(cursor.row);
            cursor.col = Math.round(cursor.col);
            
            // Set character at current position
            setChar(cursor.row, cursor.col, char);
            
            // Move cursor right, wrapping if needed
            cursor.col += 1;
            wrapCursorInSelection();
          } else {
            // Normal mode
            cursor.row = Math.round(cursor.row);
            cursor.col = Math.round(cursor.col);
            setChar(cursor.row, cursor.col, char);
            cursor.col += 1;
          }
        }
        ensureCursorVisible();
        sendCursor(cursor.row, cursor.col);
        draw();
        
        // Clear the input after processing
        e.target.value = '';
        lastInputValue = '';
        lastCompositionValue = '';
        
        // Mark that we processed content and reset after delay
        lastInputHadContent = true;
        setTimeout(() => {
          lastInputHadContent = false;
        }, 100);
      } else if (value.length === 0 && lastCompositionValue.length > 0) {
        // The composition ended with empty value but we had content before
        // This likely means the user was trying to backspace
        
        // In typing boundary mode, handle backspace within selection bounds
        if (selectionMode === 1 && selection.active) {
          // Constrain cursor to selection bounds
          constrainCursorToSelection();
          cursor.row = Math.round(cursor.row);
          cursor.col = Math.round(cursor.col);
          
          // Move cursor left (wrapping if needed)
          moveCursorLeftInSelection();
          cursor.row = Math.round(cursor.row);
          cursor.col = Math.round(cursor.col);
          
          // Delete character at new cursor position
          setChar(cursor.row, cursor.col, '');
          
          ensureCursorVisible();
          sendCursor(cursor.row, cursor.col);
          draw();
          return;
        }
        
        // If there's an active selection, delete it (normal mode)
        if (selection.active) {
          const minRow = Math.min(selection.startRow, selection.endRow);
          const maxRow = Math.max(selection.startRow, selection.endRow);
          const minCol = Math.min(selection.startCol, selection.endCol);
          const maxCol = Math.max(selection.startCol, selection.endCol);
          
          // Delete selected text
          for (let r = minRow; r <= maxRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
              setChar(r, c, '');
            }
          }
          
          // Set cursor to start of selection
          cursor.row = minRow;
          cursor.col = minCol;
          selection.active = false;
          ensureCursorVisible();
          sendCursor(cursor.row, cursor.col);
          draw();
          return;
        }
        
        cursor.row = Math.round(cursor.row);
        cursor.col = Math.round(cursor.col);
        cursor.col -= 1;
        setChar(cursor.row, cursor.col, '');
        ensureCursorVisible();
        sendCursor(cursor.row, cursor.col);
        draw();
        
        // Track this as a backspace
        trackKeyPress('Backspace', 'Backspace', e);
      }
      
      // Update debug info to show composition ended
      if (debugMenuVisible) {
        const lastKeyEl = document.getElementById('last-key');
        const keyCodeEl = document.getElementById('key-code');
        const rawKeyCodeEl = document.getElementById('raw-keycode');
        const keyEventTypeEl = document.getElementById('key-event-type');
        
        if (lastKeyEl) lastKeyEl.textContent = 'Composition End';
        if (keyCodeEl) keyCodeEl.textContent = 'compositionend';
        if (rawKeyCodeEl) rawKeyCodeEl.textContent = '229';
        if (keyEventTypeEl) keyEventTypeEl.textContent = 'compositionend';
        
        updateDebugInfo();
      }
    });

    mobileInput.addEventListener('keydown', (e) => {
      // Completely ignore keycode 229 events - Chrome on Android sends these but they're not reliable
      // All input is handled through the 'input' event instead
      if (e.keyCode === 229 || e.which === 229) {
          return;
      }
      
      // Track the key press for debug menu (only for non-composition events)
      trackKeyPress(e.key, e.code, e);
      
      // Handle special keys - let regular characters go through to input event
      if (e.key === 'Backspace' || e.code === 'Backspace') {
        // Handle backspace - input event might not fire if field is empty
        e.preventDefault();
        
        // Check for Option/Alt + Backspace (word deletion) FIRST, before other handling
        if (e.altKey || e.metaKey) {
          // Clear input value for word deletion
          e.target.value = '';
          lastInputValue = '';
          
          // Ensure cursor is at integer grid position
          cursor.row = Math.round(cursor.row);
          cursor.col = Math.round(cursor.col);
          
          // Check if we're in selection mode with active selection
          const inSelection = selectionMode === 1 && selection.active;
          let searchStart = cursor.col - 1;
          let searchLimit = origin.col - MAX_WORD_SEARCH_DISTANCE;
          
          if (inSelection) {
            const minRow = Math.min(selection.startRow, selection.endRow);
            const maxRow = Math.max(selection.startRow, selection.endRow);
            const minCol = Math.min(selection.startCol, selection.endCol);
            const maxCol = Math.max(selection.startCol, selection.endCol);
            
            // Constrain search to selection bounds
            searchLimit = Math.max(minCol - 1, origin.col - MAX_WORD_SEARCH_DISTANCE);
            
            // Constrain cursor to selection bounds
            constrainCursorToSelection();
            cursor.row = Math.round(cursor.row);
            cursor.col = Math.round(cursor.col);
          }
          
          // First check if there's a word character at the cursor position
          const charAtCursor = getChar(cursor.row, cursor.col);
          let foundWordChar = isWordCharacter(charAtCursor);
          let pos = foundWordChar ? cursor.col : searchStart;
          
          // If not found at cursor, search backwards
          if (!foundWordChar) {
            let searchSteps = 0;
            while (pos >= searchLimit && searchSteps < MAX_WORD_SEARCH_DISTANCE) {
              const char = getChar(cursor.row, pos);
              if (isWordCharacter(char)) {
                foundWordChar = true;
                break;
              }
              pos -= 1;
              searchSteps += 1;
            }
          }
          
          if (!foundWordChar) {
            // Nothing to delete - wrap to previous row if in selection, otherwise go to left edge
            if (inSelection) {
              const minRow = Math.min(selection.startRow, selection.endRow);
              const maxRow = Math.max(selection.startRow, selection.endRow);
              const minCol = Math.min(selection.startCol, selection.endCol);
              const maxCol = Math.max(selection.startCol, selection.endCol);
              
              // Move to previous row, wrapping if needed
              cursor.row -= 1;
              cursor.col = maxCol;
              
              // If past top, wrap to bottom-right
              if (cursor.row < minRow) {
                cursor.row = maxRow;
                cursor.col = maxCol;
              }
            } else {
              // Not in selection - move cursor to left edge of viewport
              cursor.col = origin.col;
            }
          } else {
            let wordStart = pos;
            let steps = 0;
            const wordSearchLimit = inSelection ? 
              Math.max(Math.min(selection.startCol, selection.endCol) - 1, searchLimit) : 
              searchLimit;
            
            // Find the start of the word by going backwards
            while (wordStart - 1 >= wordSearchLimit && steps < MAX_WORD_SEARCH_DISTANCE) {
              const prevChar = getChar(cursor.row, wordStart - 1);
              if (!isWordCharacter(prevChar)) break;
              wordStart -= 1;
              steps += 1;
            }
            
            // Delete all characters from wordStart to cursor position (inclusive)
            // Include the character at cursor.col
            for (let col = wordStart; col <= cursor.col; col++) {
              setChar(cursor.row, col, '');
            }
            
            // Mark batch as applied immediately for word deletion
            if (undoStack.length > 0) {
              undoStack[undoStack.length - 1].applied = true;
            }
            
            cursor.col = wordStart;
          }
          
          ensureCursorVisible();
          sendCursor(cursor.row, cursor.col);
          draw();
          return;
        }
        
        // Regular backspace handling (not Option+Backspace)
        e.target.value = '';
        lastInputValue = '';
        
        // In typing boundary mode, handle backspace within selection bounds
        if (selectionMode === 1 && selection.active) {
          // Constrain cursor to selection bounds
          constrainCursorToSelection();
          cursor.row = Math.round(cursor.row);
          cursor.col = Math.round(cursor.col);
          
          // Move cursor left (wrapping if needed)
          moveCursorLeftInSelection();
          cursor.row = Math.round(cursor.row);
          cursor.col = Math.round(cursor.col);
          
          // Delete character at new cursor position
          setChar(cursor.row, cursor.col, '');
          
          ensureCursorVisible();
          sendCursor(cursor.row, cursor.col);
          draw();
          return;
        }
        
        // If there's an active selection, delete it (normal mode)
        if (selection.active) {
          const minRow = Math.min(selection.startRow, selection.endRow);
          const maxRow = Math.max(selection.startRow, selection.endRow);
          const minCol = Math.min(selection.startCol, selection.endCol);
          const maxCol = Math.max(selection.startCol, selection.endCol);
          
          // Delete selected text
          for (let r = minRow; r <= maxRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
              setChar(r, c, '');
            }
          }
          
          // Set cursor to start of selection
          cursor.row = minRow;
          cursor.col = minCol;
          selection.active = false;
          sendSelection(); // Notify other clients that selection is cleared
          ensureCursorVisible();
          sendCursor(cursor.row, cursor.col);
          draw();
          return;
        }
        
        // Regular backspace: delete one character
        cursor.row = Math.round(cursor.row);
        cursor.col = Math.round(cursor.col);
        cursor.col -= 1;
        setChar(cursor.row, cursor.col, '');
        
        ensureCursorVisible();
        sendCursor(cursor.row, cursor.col);
        draw();
      } else if (e.key === 'Enter') {
        if (selectionMode === 1 && selection.active) {
          const minRow = Math.min(selection.startRow, selection.endRow);
          const maxRow = Math.max(selection.startRow, selection.endRow);
          const minCol = Math.min(selection.startCol, selection.endCol);
          
          cursor.row += 1;
          if (cursor.row > maxRow) {
            cursor.row = minRow;
          }
          cursor.col = minCol;
        } else {
          cursor.row += 1;
          // If there's an active selection, use the left edge of the selection
          if (selection.active) {
            cursor.col = Math.min(selection.startCol, selection.endCol);
          } else {
            cursor.col = origin.col;
          }
        }
        ensureCursorVisible();
        sendCursor(cursor.row, cursor.col);
        draw();
        e.preventDefault();
      } else if (e.key === 'ArrowLeft') {
        cursor.col = Math.round(cursor.col) - 1;
        ensureCursorVisible();
        sendCursor(cursor.row, cursor.col);
        draw();
        e.preventDefault();
      } else if (e.key === 'ArrowRight') {
        cursor.col = Math.round(cursor.col) + 1;
        ensureCursorVisible();
        sendCursor(cursor.row, cursor.col);
        draw();
        e.preventDefault();
      } else if (e.key === 'ArrowUp') {
        cursor.row = Math.round(cursor.row) - 1;
        ensureCursorVisible();
        sendCursor(cursor.row, cursor.col);
        draw();
        e.preventDefault();
      } else if (e.key === 'ArrowDown') {
        cursor.row = Math.round(cursor.row) + 1;
        ensureCursorVisible();
        sendCursor(cursor.row, cursor.col);
        draw();
        e.preventDefault();
      }
      // Note: Regular character input is handled by the 'input' event, not here
      // This prevents interference with normal typing
    });
  }

  // Keyboard handling for canvas grid
  window.addEventListener('keydown', (e) => {
    // Ignore if coordinate input is focused
    if (document.activeElement === cellCoordsInput) {
      return;
    }
    
    // Track the key press for debug menu
    trackKeyPress(e.key, e.code, e);
    
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
      // Handle copy (Ctrl+C / Cmd+C)
      if (e.key === 'c' || e.key === 'C') {
        if (selection.active) {
          copySelection();
          e.preventDefault();
          return;
        }
      }
      // Handle paste (Ctrl+V / Cmd+V)
      if (e.key === 'v' || e.key === 'V') {
        if (document.activeElement === canvas) {
          pasteText();
          e.preventDefault();
          return;
        }
      }
      // Handle undo (Ctrl+Z / Cmd+Z)
      if (e.key === 'z' || e.key === 'Z') {
        if (!e.shiftKey && document.activeElement === canvas) {
          applyUndo();
          e.preventDefault();
          return;
        }
      }
      // Handle redo (Ctrl+Shift+Z / Cmd+Shift+Z or Ctrl+Y / Cmd+Y)
      if ((e.key === 'z' || e.key === 'Z') && e.shiftKey) {
        if (document.activeElement === canvas) {
          applyRedo();
          e.preventDefault();
          return;
        }
      }
      if (e.key === 'y' || e.key === 'Y') {
        if (document.activeElement === canvas) {
          applyRedo();
          e.preventDefault();
          return;
        }
      }
    }
    
    if (document.activeElement !== canvas) {
      return;
    }
    const k = e.key;
    
    // Check for secret debug sequence "debugdebugdebug"
    if (k.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // Add to sequence (keep last N characters where N is sequence length)
      debugKeySequence += k.toLowerCase();
      if (debugKeySequence.length > DEBUG_SEQUENCE.length) {
        debugKeySequence = debugKeySequence.slice(-DEBUG_SEQUENCE.length);
      }
      
      // Check if sequence matches
      if (debugKeySequence === DEBUG_SEQUENCE) {
        toggleDebugMenu();
        debugKeySequence = ''; // Reset sequence
        e.preventDefault();
        return;
      }
    } else {
      // Reset sequence on non-character keys
      debugKeySequence = '';
    }
    
    if (k.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // In typing boundary mode, keep selection and constrain cursor
      if (selectionMode === 1 && selection.active) {
        // Constrain cursor to selection bounds
        constrainCursorToSelection();
        cursor.row = Math.round(cursor.row);
        cursor.col = Math.round(cursor.col);
        
        // Set character at current position
        setChar(cursor.row, cursor.col, k);
        
        // Move cursor right, wrapping if needed
        cursor.col += 1;
        wrapCursorInSelection();
        
        ensureCursorVisible();
        sendCursor(cursor.row, cursor.col);
        draw();
        e.preventDefault();
        return;
      }
      
      // Normal mode: Move cursor to selection start and clear selection when typing
      if (selection.active) {
        moveCursorToSelectionStart();
        selection.active = false;
      }
      // Ensure cursor is at integer grid position
      cursor.row = Math.round(cursor.row);
      cursor.col = Math.round(cursor.col);
      setChar(cursor.row, cursor.col, k);
      cursor.col += 1;
      ensureCursorVisible();
      sendCursor(cursor.row, cursor.col);
      draw();
      e.preventDefault();
      return;
    }
    if (k === 'Backspace' || e.code === 'Backspace') {
      // In typing boundary mode, handle backspace within selection bounds
      if (selectionMode === 1 && selection.active) {
        // Constrain cursor to selection bounds
        constrainCursorToSelection();
        cursor.row = Math.round(cursor.row);
        cursor.col = Math.round(cursor.col);
        
        // Move cursor left (wrapping if needed)
        moveCursorLeftInSelection();
        cursor.row = Math.round(cursor.row);
        cursor.col = Math.round(cursor.col);
        
        // Delete character at new cursor position
        setChar(cursor.row, cursor.col, '');
        
        ensureCursorVisible();
        sendCursor(cursor.row, cursor.col);
        draw();
        e.preventDefault();
        return;
      }
      
      // If there's an active selection, delete it (normal mode)
      if (selection.active) {
        const minRow = Math.min(selection.startRow, selection.endRow);
        const maxRow = Math.max(selection.startRow, selection.endRow);
        const minCol = Math.min(selection.startCol, selection.endCol);
        const maxCol = Math.max(selection.startCol, selection.endCol);
        
        // Delete selected text
        for (let r = minRow; r <= maxRow; r++) {
          for (let c = minCol; c <= maxCol; c++) {
            setChar(r, c, '');
          }
        }
        
        // Set cursor to start of selection
        cursor.row = minRow;
        cursor.col = minCol;
        selection.active = false;
        sendSelection(); // Notify other clients that selection is cleared
        ensureCursorVisible();
        sendCursor(cursor.row, cursor.col);
        draw();
        e.preventDefault();
        return;
      }
      
      // Ensure cursor is at integer grid position
      cursor.row = Math.round(cursor.row);
      cursor.col = Math.round(cursor.col);
      
      // Check for Option/Alt + Backspace (word deletion)
      if (e.altKey || e.metaKey) {
        // Check if we're in selection mode with active selection
        const inSelection = selectionMode === 1 && selection.active;
        let searchStart = cursor.col - 1;
        let searchLimit = origin.col - MAX_WORD_SEARCH_DISTANCE;
        
        if (inSelection) {
          const minRow = Math.min(selection.startRow, selection.endRow);
          const maxRow = Math.max(selection.startRow, selection.endRow);
          const minCol = Math.min(selection.startCol, selection.endCol);
          const maxCol = Math.max(selection.startCol, selection.endCol);
          
          // Constrain search to selection bounds
          searchLimit = Math.max(minCol - 1, origin.col - MAX_WORD_SEARCH_DISTANCE);
          
          // Constrain cursor to selection bounds
          constrainCursorToSelection();
          cursor.row = Math.round(cursor.row);
          cursor.col = Math.round(cursor.col);
        }
        
        // First check if there's a word character at the cursor position
        const charAtCursor = getChar(cursor.row, cursor.col);
        let foundWordChar = isWordCharacter(charAtCursor);
        let pos = foundWordChar ? cursor.col : searchStart;
        
        // If not found at cursor, search backwards
        if (!foundWordChar) {
          let searchSteps = 0;
          while (pos >= searchLimit && searchSteps < MAX_WORD_SEARCH_DISTANCE) {
            const char = getChar(cursor.row, pos);
            if (isWordCharacter(char)) {
              foundWordChar = true;
              break;
            }
            pos -= 1;
            searchSteps += 1;
          }
        }
        
        if (!foundWordChar) {
          // Nothing to delete - wrap to previous row if in selection, otherwise go to left edge
          if (inSelection) {
            const minRow = Math.min(selection.startRow, selection.endRow);
            const maxRow = Math.max(selection.startRow, selection.endRow);
            const minCol = Math.min(selection.startCol, selection.endCol);
            const maxCol = Math.max(selection.startCol, selection.endCol);
            
            // Move to previous row, wrapping if needed
            cursor.row -= 1;
            cursor.col = maxCol;
            
            // If past top, wrap to bottom-right
            if (cursor.row < minRow) {
              cursor.row = maxRow;
              cursor.col = maxCol;
            }
          } else {
            // Not in selection - move cursor to left edge of viewport
            cursor.col = origin.col;
          }
        } else {
          let wordStart = pos;
          let steps = 0;
          const wordSearchLimit = inSelection ? 
            Math.max(Math.min(selection.startCol, selection.endCol) - 1, searchLimit) : 
            searchLimit;
          
          // Find the start of the word by going backwards
          while (wordStart - 1 >= wordSearchLimit && steps < MAX_WORD_SEARCH_DISTANCE) {
            const prevChar = getChar(cursor.row, wordStart - 1);
            if (!isWordCharacter(prevChar)) break;
            wordStart -= 1;
            steps += 1;
          }
          
          // Delete all characters from wordStart to cursor position (inclusive)
          // Include the character at cursor.col
          for (let col = wordStart; col <= cursor.col; col++) {
            setChar(cursor.row, col, '');
          }
          
          // Mark batch as applied immediately for word deletion
          if (undoStack.length > 0) {
            undoStack[undoStack.length - 1].applied = true;
          }
          
          cursor.col = wordStart;
        }
      } else {
        // Regular backspace: delete one character
        cursor.col -= 1;
        setChar(cursor.row, cursor.col, '');
      }
      
      ensureCursorVisible();
      sendCursor(cursor.row, cursor.col);
      draw();
      e.preventDefault();
      return;
    }
    if (k === 'Enter') {
      if (selectionMode === 1 && selection.active) {
        const minRow = Math.min(selection.startRow, selection.endRow);
        const maxRow = Math.max(selection.startRow, selection.endRow);
        const minCol = Math.min(selection.startCol, selection.endCol);
        
        cursor.row += 1;
        if (cursor.row > maxRow) {
          cursor.row = minRow;
        }
        cursor.col = minCol;
      } else {
        cursor.row += 1;
        // If there's an active selection, use the left edge of the selection
        if (selection.active) {
          cursor.col = Math.min(selection.startCol, selection.endCol);
        } else {
          cursor.col = origin.col;
        }
      }
      ensureCursorVisible();
      sendCursor(cursor.row, cursor.col);
      draw();
      e.preventDefault();
      return;
    }
    if (k === 'ArrowLeft') { 
      cursor.col = Math.round(cursor.col) - 1; 
      ensureCursorVisible(); 
      sendCursor(cursor.row, cursor.col); 
      draw(); 
      e.preventDefault(); 
    }
    if (k === 'ArrowRight') { 
      cursor.col = Math.round(cursor.col) + 1; 
      ensureCursorVisible(); 
      sendCursor(cursor.row, cursor.col); 
      draw(); 
      e.preventDefault(); 
    }
    if (k === 'ArrowUp') { 
      cursor.row = Math.round(cursor.row) - 1; 
      ensureCursorVisible(); 
      sendCursor(cursor.row, cursor.col); 
      draw(); 
      e.preventDefault(); 
    }
    if (k === 'ArrowDown') { 
      cursor.row = Math.round(cursor.row) + 1;
      ensureCursorVisible();
      sendCursor(cursor.row, cursor.col);
      draw();
      e.preventDefault();
    }
    if (k === 'Escape') {
      // Clear selection
      if (selection.active) {
        selection.active = false;
        sendSelection();
        draw();
      }
      e.preventDefault();
    }
  });

  function ensureCursorVisible() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const left = origin.col;
    const top = origin.row;
    const right = origin.col + Math.floor(w / (CELL_W * zoom)) - 1;
    const bottom = origin.row + Math.floor(h / (CELL_H * zoom)) - 1;
    const cursorBefore = { row: cursor.row, col: cursor.col };
    if (cursor.col < left) origin.col = cursor.col;
    if (cursor.col > right) origin.col = cursor.col - Math.floor(w / (CELL_W * zoom)) + 1;
    if (cursor.row < top) origin.row = cursor.row;
    if (cursor.row > bottom) origin.row = cursor.row - Math.floor(h / (CELL_H * zoom)) + 1;
    // Allow fractional origin coordinates for precise cursor positioning
  }

  // Panning with wheel and drag
  canvas.addEventListener('wheel', (e) => {
    // Don't handle wheel events during active selection dragging
    // But allow panning when selection is just active (not being dragged)
    if (isSelecting) {
      e.preventDefault();
      return;
    }
    // Detect if it's a mouse wheel (not trackpad)
    // Trackpad gestures typically have very small delta values and deltaMode === 0
    // Mouse wheels have larger, discrete delta values or deltaMode !== 0
    const isMouseWheel = Math.abs(e.deltaY) > 10 || e.deltaMode !== 0;
    
    // Check for zoom (Ctrl/Cmd + wheel)
    if (e.ctrlKey || e.metaKey) {
        const rect = canvas.getBoundingClientRect();
        const centerX = e.clientX - rect.left;
        const centerY = e.clientY - rect.top;
        
      if (isMouseWheel) {
        // Use faster multiplicative zoom for mouse wheel
        const wheelZoomFactor = 1.0 + MOUSE_WHEEL_ZOOM_STEP;
        if (e.deltaY < 0) {
          setZoom(zoom * wheelZoomFactor, centerX, centerY);
        } else {
          setZoom(zoom / wheelZoomFactor, centerX, centerY);
        }
      } else {
        // Trackpad: use regular zoom step
      if (e.deltaY < 0) {
        zoomIn(centerX, centerY);
      } else {
        zoomOut(centerX, centerY);
        }
      }
      e.preventDefault();
      return;
    }
    
    // For trackpad: pan in all directions (works in all modes)
    if (!isMouseWheel) {
    const scale = 0.5; // adjust for sensitivity
      const rowDelta = e.deltaY * scale / (CELL_H * zoom);
      const colDelta = e.deltaX * scale / (CELL_W * zoom);
      origin.row += rowDelta;
    origin.col += colDelta;
      draw();
      e.preventDefault();
      return;
    }
    
    // For mouse wheel: maintain original behavior
    // Handle Shift + wheel for horizontal scrolling
    if (e.shiftKey) {
      const scale = 0.5; // adjust for sensitivity
      const colDelta = e.deltaY * scale / (CELL_W * zoom);
      origin.col += colDelta;
      draw();
      e.preventDefault();
      return;
    }
    
    // Normal mouse wheel scrolling: vertical panning only
    const scale = 0.5; // adjust for sensitivity
    const rowDelta = e.deltaY * scale / (CELL_H * zoom);
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
  
  // Middle and right mouse button drag support for panning in all modes
  canvas.addEventListener('mousedown', (e) => {
    // Middle mouse button (button 1) for panning in all modes
    if (e.button === 1 || e.button === 2 || e.altKey) {
      isDragging = true;
      dragStart.x = e.clientX;
      dragStart.y = e.clientY;
      dragStart.originRow = origin.row;
      dragStart.originCol = origin.col;
      e.preventDefault();
    }
  });
  
  // Use document instead of window for better event capture during drag
  // Middle/right mouse button panning works in all modes
  // Left mouse panning only works in pan mode (handled separately in handleMouseDown)
  document.addEventListener('mousemove', (e) => {
    // Don't handle panning during active selection dragging
    if (isSelecting) {
      return;
    }
    if (!isDragging) {
      return;
    }
    // Middle/right mouse button panning works in all modes
    // Left mouse panning in pan mode is handled separately, so skip it here
    // (We detect this by checking if we're in pan mode and the drag was started by left mouse)
    // For now, just handle all dragging here - the pan mode handler will take precedence
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    origin.col = dragStart.originCol - dx / (CELL_W * zoom);
    origin.row = dragStart.originRow - dy / (CELL_H * zoom);
    draw();
  });
  
  window.addEventListener('mouseup', (e) => { 
    // Don't clear isDragging in pan mode - let the pan mode handler manage it
    if (selectionMode !== 2) {
      isDragging = false;
    }
  });

  // Touch drag support for panning (handled in handleTouchStart above)

  window.addEventListener('touchmove', (e) => {
    // Don't handle touch events if they're on color picker elements
    const colorPickerContainer = document.getElementById('color-picker-container');
    if (colorPickerContainer && e.target && colorPickerContainer.contains(e.target)) {
      e.preventDefault(); // Prevent page scrolling
      return; // Let the color picker handle its own touch events
    }
    
    const touches = e.touches;
    
    // Check selection mode - now allow pinch zoom in all modes
    const isSelectionMode = selectionMode === 0 || selectionMode === 1;
    const isPanMode = selectionMode === 2;
    
    // Handle pinch gesture (two fingers) - now enabled in all modes
    if (touches.length === 2) {
      // If we're not already pinching, initialize pinch gesture
      if (!isPinching) {
        // Track if we were previously dragging
        wasDraggingBeforePinch = isTouchDragging;
        
        isPinching = true;
        isTouchDragging = false;
        
        // Cancel any active selection when two fingers are detected
        if (isSelecting) {
          isSelecting = false;
        }
        
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
      
      // Calculate changes for both zoom and pan
      const distanceChange = Math.abs(distance - pinchStart.distance);
      const centerChangeX = centerX - lastGestureCenter.x;
      const centerChangeY = centerY - lastGestureCenter.y;
      
      let needsRedraw = false;
      
      // Apply zoom if distance changed (pinch gesture)
      if (distanceChange > 1) { // Small threshold to avoid jitter
        const scale = distance / pinchStart.distance;
        // Apply zoom speed sensitivity: ZOOM_STEP controls how sensitive pinch zoom is
        // Normalize to default ZOOM_STEP of 0.05, so higher values = more sensitive, lower = less sensitive
        const sensitivityMultiplier = ZOOM_STEP / 0.05;
        const scaleChange = scale - 1.0; // How much the scale changed from 1.0
        const adjustedScale = 1.0 + (scaleChange * sensitivityMultiplier);
        const newZoom = pinchStart.zoom * adjustedScale;
        // Use current center coordinates (already relative to canvas) instead of stored pinch start
        // Note: setZoom updates the global zoom variable and calls draw() internally
        setZoom(newZoom, centerX, centerY);
        // Update pinchStart.zoom to the new zoom level for next frame
        pinchStart.zoom = newZoom;
        // Update pinchStart.distance to current distance to prevent accumulation
        pinchStart.distance = distance;
        needsRedraw = true; // setZoom already calls draw(), but we'll handle it below
      }
      
      // Apply pan if center moved (pan gesture)
      // Use the current zoom value (which may have been updated by setZoom above)
      if (Math.abs(centerChangeX) > 0.5 || Math.abs(centerChangeY) > 0.5) { // Small threshold to avoid jitter
        // Pan using the center movement
        origin.col -= centerChangeX / (CELL_W * zoom);
        origin.row -= centerChangeY / (CELL_H * zoom);
        needsRedraw = true;
      }
      
      // Only draw once if either zoom or pan happened (setZoom already draws, but we redraw to ensure pan is visible)
      if (needsRedraw) {
        draw();
      }
      
      // Update last position for next frame
      lastGestureCenter.x = centerX;
      lastGestureCenter.y = centerY;
      
      e.preventDefault();
      return;
    }
    
    // If we were pinching and now have only one finger, smoothly transition to drag mode
    // Only transition once - use a flag to prevent repeated transitions
    if (isPinching && touches.length === 1 && !isTouchDragging) {
      
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
    
    // If we're in selection mode and there are two active touches, don't process single touch
    // (This handles the case where one finger lifts but we're still in pinch mode)
    if (isSelectionMode && activeTouches.size >= 2) {
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
    
    // If we're in selection mode and selecting, don't pan
    if (isSelectionMode && isSelecting) {
      e.preventDefault();
      return;
    }
    
    // If moved more than 10 pixels, start dragging (only for pan mode)
    if (isPanMode && !isTouchDragging && !isPinching && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      isTouchDragging = true;
    }
    
    // Only pan if we're in pan mode or defaulting to pan behavior
    if ((isPanMode || (!isSelectionMode && !isSelecting)) && isTouchDragging && !isPinching) {
      // Use fractional coordinates for smooth movement
      origin.col = touchStart.originCol - (dx / (CELL_W * zoom));
      origin.row = touchStart.originRow - (dy / (CELL_H * zoom));
      draw();
    }
    e.preventDefault();
  }, { passive: false });

  window.addEventListener('touchend', (e) => { 
    // Don't handle touch events if they're on color picker elements
    const colorPickerContainer = document.getElementById('color-picker-container');
    if (colorPickerContainer && e.target && colorPickerContainer.contains(e.target)) {
      e.preventDefault(); // Prevent page scrolling
      return; // Let the color picker handle its own touch events
    }
    
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
  if (colorPreview && colorPicker && colorPickerWindow) {
    const openColorPicker = () => {
      colorPickerWindow.classList.remove('color-picker-hidden');
      colorPicker.focus();
      colorPicker.select();
      
      // Update sliders to match current color
      updateSlidersFromHex(myColor);
    };
    
    const closeColorPicker = () => {
      colorPickerWindow.classList.add('color-picker-hidden');
    };
    
    // Click on preview to open color picker window
    colorPreview.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent canvas from getting focus
      e.preventDefault(); // Prevent any default behavior
      
      // Check if color picker is already open
      const isOpen = !colorPickerWindow.classList.contains('color-picker-hidden');
      
      if (isOpen) {
        closeColorPicker();
      } else {
        openColorPicker();
      }
    });
    
    // Close when clicking outside the color picker window
    colorPickerWindow.addEventListener('click', (e) => {
      if (e.target === colorPickerWindow) {
        closeColorPicker();
      }
    });
    
    // Prevent closing when clicking inside the content
    if (colorPickerContent) {
      colorPickerContent.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    }
    
    // Add touch event handling for mobile
    colorPreview.addEventListener('touchstart', (e) => {
      e.stopPropagation(); // Prevent canvas from getting the touch event
      e.preventDefault(); // Prevent default touch behavior
    }, { passive: false });
    
    colorPreview.addEventListener('touchend', (e) => {
      e.stopPropagation(); // Prevent canvas from getting the touch event
      e.preventDefault(); // Prevent default touch behavior
      // Trigger the click behavior
      colorPreview.click();
    }, { passive: false });
    
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
    
    // Add touch event handling for mobile
    colorPicker.addEventListener('touchstart', (e) => {
      e.stopPropagation(); // Prevent canvas from getting the touch event
      e.preventDefault(); // Prevent default touch behavior
      colorPicker.focus();
    }, { passive: false });
    
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
    });
    
    // Close window when Enter or Escape is pressed
    colorPicker.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        if (e.key === 'Enter') {
          colorPicker.blur(); // This will trigger validation
        }
        closeColorPicker();
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
    
    // Touch event handling for mobile (already handled in click handler above)
  }

  // Add slider event listeners
  if (hueSlider && brightnessSlider) {
    // Track when user starts using sliders
    hueSlider.addEventListener('mousedown', (e) => {
      e.stopPropagation(); // Prevent canvas from getting the event
      isUsingSliders = true;
    });
    brightnessSlider.addEventListener('mousedown', (e) => {
      e.stopPropagation(); // Prevent canvas from getting the event
      isUsingSliders = true;
    });
    
    // Track when user stops using sliders
    hueSlider.addEventListener('mouseup', (e) => {
      e.stopPropagation(); // Prevent canvas from getting the event
      setTimeout(() => {
        isUsingSliders = false;
      }, 100);
    });
    brightnessSlider.addEventListener('mouseup', (e) => {
      e.stopPropagation(); // Prevent canvas from getting the event
      setTimeout(() => {
        isUsingSliders = false;
      }, 100);
    });
    
    // Also handle touch events for mobile - CRITICAL for mobile slider functionality
    hueSlider.addEventListener('touchstart', (e) => {
      e.stopPropagation(); // Prevent canvas from getting the touch event
      
      const touch = e.touches[0];
      fineControlMode.startX = touch.clientX;
      fineControlMode.startY = touch.clientY;
      // Don't set startValue here - it will be set when entering fine control mode
      
      // Don't prevent default - let the slider work normally
    }, { passive: false });
    
    brightnessSlider.addEventListener('touchstart', (e) => {
      e.stopPropagation(); // Prevent canvas from getting the touch event
      
      const touch = e.touches[0];
      fineControlMode.startX = touch.clientX;
      fineControlMode.startY = touch.clientY;
      // Don't set startValue here - it will be set when entering fine control mode
      
      // Don't prevent default - let the slider work normally
    }, { passive: false });
    
    hueSlider.addEventListener('touchmove', (e) => {
      e.stopPropagation(); // Prevent canvas from getting the touch event
      
      const touch = e.touches[0];
      const rect = hueSlider.getBoundingClientRect();
      const sliderCenterY = rect.top + rect.height / 2;
      const currentDistance = Math.abs(touch.clientY - sliderCenterY);
      
      // Enter fine control mode if moved away from slider enough
      if (currentDistance >= fineControlMode.minDistance && !fineControlMode.active) {
        fineControlMode.startX = touch.clientX; // Update X reference to current position
        enterFineControlMode(hueSlider, fineControlMode.startY);
      }
      
      // If in fine control mode, handle the movement
      if (fineControlMode.active && fineControlMode.slider === hueSlider) {
        e.preventDefault(); // Prevent default slider behavior in fine control mode
        handleFineControlMove(touch, hueSlider);
      }
      // Otherwise, let the slider work normally
    }, { passive: false });
    
    brightnessSlider.addEventListener('touchmove', (e) => {
      e.stopPropagation(); // Prevent canvas from getting the touch event
      
      const touch = e.touches[0];
      const rect = brightnessSlider.getBoundingClientRect();
      const sliderCenterY = rect.top + rect.height / 2;
      const currentDistance = Math.abs(touch.clientY - sliderCenterY);
      
      // Enter fine control mode if moved away from slider enough
      if (currentDistance >= fineControlMode.minDistance && !fineControlMode.active) {
        fineControlMode.startX = touch.clientX; // Update X reference to current position
        enterFineControlMode(brightnessSlider, fineControlMode.startY);
      }
      
      // If in fine control mode, handle the movement
      if (fineControlMode.active && fineControlMode.slider === brightnessSlider) {
        e.preventDefault(); // Prevent default slider behavior in fine control mode
        handleFineControlMove(touch, brightnessSlider);
      }
      // Otherwise, let the slider work normally
    }, { passive: false });
    
    hueSlider.addEventListener('touchend', (e) => {
      e.stopPropagation(); // Prevent canvas from getting the touch event
      
      // Exit fine control mode if it was active for this slider
      if (fineControlMode.active && fineControlMode.slider === hueSlider) {
        exitFineControlMode();
      }
      
      // Don't prevent default - let the slider work normally
    }, { passive: false });
    
    brightnessSlider.addEventListener('touchend', (e) => {
      e.stopPropagation(); // Prevent canvas from getting the touch event
      
      // Exit fine control mode if it was active for this slider
      if (fineControlMode.active && fineControlMode.slider === brightnessSlider) {
        exitFineControlMode();
      }
      
      // Don't prevent default - let the slider work normally
    }, { passive: false });
    
    // Update color while dragging
    hueSlider.addEventListener('input', (e) => {
      updateHexFromSliders();
    });
    brightnessSlider.addEventListener('input', (e) => {
      updateHexFromSliders();
    });
  }

  // Prevent touch events on color picker container from reaching canvas
  const colorPickerContainer = document.getElementById('color-picker-container');
  if (colorPickerContainer) {
    const handleColorPickerTouch = (e) => {
      e.stopPropagation(); // Prevent canvas from getting the touch event
      // Only prevent default for non-slider elements to avoid interfering with slider functionality
      if (e.target !== hueSlider && e.target !== brightnessSlider) {
        e.preventDefault(); // Prevent default touch behavior
      }
    };
    
    colorPickerContainer.addEventListener('touchstart', handleColorPickerTouch, { passive: false });
    colorPickerContainer.addEventListener('touchmove', handleColorPickerTouch, { passive: false });
    colorPickerContainer.addEventListener('touchend', handleColorPickerTouch, { passive: false });
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

  // Selection mode functions
  function updateSelectionModeButton() {
    if (!selectionModeBtn) return;
    const icon = document.getElementById('selection-mode-icon');
    if (!icon) return;
    
    if (selectionMode === 1) {
      icon.src = '/assets/text.png';
      selectionModeBtn.title = 'Selection mode: Typing boundary (click to change)';
    } else if (selectionMode === 2) {
      icon.src = '/assets/palm.png';
      selectionModeBtn.title = 'Selection mode: Pan mode (click to change)';
    } else {
      icon.src = '/assets/selection.png';
      selectionModeBtn.title = 'Selection mode: Normal (click to change)';
    }
  }
  
  function constrainCursorToSelection() {
    if (selectionMode !== 1 || !selection.active) return;
    
    const minRow = Math.min(selection.startRow, selection.endRow);
    const maxRow = Math.max(selection.startRow, selection.endRow);
    const minCol = Math.min(selection.startCol, selection.endCol);
    const maxCol = Math.max(selection.startCol, selection.endCol);
    
    // Constrain cursor to selection bounds
    if (cursor.row < minRow) {
      cursor.row = minRow;
      cursor.col = minCol;
    } else if (cursor.row > maxRow) {
      cursor.row = maxRow;
      cursor.col = maxCol;
    } else {
      if (cursor.col < minCol) {
        cursor.col = minCol;
      } else if (cursor.col > maxCol) {
        cursor.col = maxCol;
      }
    }
  }
  
  function moveCursorLeftInSelection() {
    if (selectionMode !== 1 || !selection.active) return false;
    
    const minRow = Math.min(selection.startRow, selection.endRow);
    const maxRow = Math.max(selection.startRow, selection.endRow);
    const minCol = Math.min(selection.startCol, selection.endCol);
    const maxCol = Math.max(selection.startCol, selection.endCol);
    
    // Move cursor left
    cursor.col -= 1;
    
    // If past left edge, wrap to end of previous row
    if (cursor.col < minCol) {
      cursor.row -= 1;
      cursor.col = maxCol;
      // If past top, wrap to bottom-right
      if (cursor.row < minRow) {
        cursor.row = maxRow;
        cursor.col = maxCol;
      }
    }
    
    return true;
  }
  
  function wrapCursorInSelection() {
    if (selectionMode !== 1 || !selection.active) return false;
    
    const minRow = Math.min(selection.startRow, selection.endRow);
    const maxRow = Math.max(selection.startRow, selection.endRow);
    const minCol = Math.min(selection.startCol, selection.endCol);
    const maxCol = Math.max(selection.startCol, selection.endCol);
    
    // Check if cursor is outside bounds
    if (cursor.col > maxCol) {
      // Move to next row
      cursor.row++;
      cursor.col = minCol;
      // If past bottom, wrap to top
      if (cursor.row > maxRow) {
        cursor.row = minRow;
        cursor.col = minCol;
      }
      return true;
    } else if (cursor.row > maxRow) {
      // Wrap to top left
      cursor.row = minRow;
      cursor.col = minCol;
      return true;
    }
    
    return false;
  }

  // Menu toggle button event listener
  if (menuToggleBtn && toolbarItems && toolbarItemsRight) {
    const toggleToolbar = () => {
      toolbarItems.classList.toggle('toolbar-hidden');
      toolbarItemsRight.classList.toggle('toolbar-hidden');
    };
    
    menuToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      toggleToolbar();
    });
    
    // Also handle touch events for mobile
    menuToggleBtn.addEventListener('touchstart', (e) => {
      e.stopPropagation();
      e.preventDefault();
    }, { passive: false });
    
    menuToggleBtn.addEventListener('touchend', (e) => {
      e.stopPropagation();
      e.preventDefault();
      toggleToolbar();
    }, { passive: false });
  }
  
  // Info button event listener
  if (infoBtn && infoWindow) {
    const openInfo = () => {
      infoWindow.classList.remove('info-hidden');
    };
    
    const closeInfo = () => {
      infoWindow.classList.add('info-hidden');
    };
    
    infoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      openInfo();
    });
    
    // Close when clicking outside the info window (but not on the link itself)
    infoWindow.addEventListener('click', (e) => {
      if (e.target === infoWindow) {
        closeInfo();
      }
    });
    
    // Prevent closing when clicking on the link
    if (infoContent) {
      infoContent.addEventListener('click', (e) => {
        e.stopPropagation();
        // Allow the link to work normally
      });
    }
    
    // Also handle touch events for mobile
    infoBtn.addEventListener('touchstart', (e) => {
      e.stopPropagation();
      e.preventDefault();
    }, { passive: false });
    
    infoBtn.addEventListener('touchend', (e) => {
      e.stopPropagation();
      e.preventDefault();
      openInfo();
    }, { passive: false });
  }
  
  // Selection mode button event listener
  if (selectionModeBtn) {
    selectionModeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      // Cycle through modes: 0 -> 1 -> 2 -> 0
      const oldMode = selectionMode;
      selectionMode = (selectionMode + 1) % 3;
      const modeNames = ['normal', 'typing boundary', 'pan'];
      updateSelectionModeButton();
      
      // Clear selection when switching to pan mode
      if (selectionMode === 2) {
        selection.active = false;
        draw();
      }
      
      // Set focus so keyboard input works immediately
      // Try mobile input first (for mobile devices), then canvas
      const mobileInput = document.getElementById('mobile-input');
      if (mobileInput) {
        mobileInput.focus();
      } else {
        canvas.focus();
      }
    });
    
    // Also handle touch events for mobile
    const handleSelectionModeTouch = (e) => {
      e.stopPropagation();
      e.preventDefault();
    };
    
    selectionModeBtn.addEventListener('touchstart', handleSelectionModeTouch, { passive: false });
    selectionModeBtn.addEventListener('touchend', (e) => {
      handleSelectionModeTouch(e);
      // Cycle through modes
      const oldMode = selectionMode;
      selectionMode = (selectionMode + 1) % 3;
      const modeNames = ['normal', 'typing boundary', 'pan'];
      updateSelectionModeButton();
      
      // Clear selection when switching to pan mode
      if (selectionMode === 2) {
        selection.active = false;
        draw();
      }
      
      // Set focus so keyboard input works immediately
      // Try mobile input first (for mobile devices), then canvas
      const mobileInput = document.getElementById('mobile-input');
      if (mobileInput) {
        mobileInput.focus();
      } else {
        canvas.focus();
      }
    }, { passive: false });
    
    // Initialize button appearance
    updateSelectionModeButton();
  }

  // Reset zoom button event listener
  if (resetZoomBtn) {
    resetZoomBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      resetZoomAndCenter();
    });
    
    // Also handle touch events for mobile
    const handleResetZoomTouch = (e) => {
      e.stopPropagation(); // Prevent canvas from getting the touch event
      e.preventDefault(); // Prevent default touch behavior
    };
    
    resetZoomBtn.addEventListener('touchstart', handleResetZoomTouch, { passive: false });
    resetZoomBtn.addEventListener('touchend', (e) => {
      handleResetZoomTouch(e);
      resetZoomAndCenter();
    }, { passive: false });
  }

  // Undo button event listener
  if (undoBtn) {
    undoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      applyUndo();
    });
    
    // Also handle touch events for mobile
    const handleUndoTouch = (e) => {
      e.stopPropagation(); // Prevent canvas from getting the touch event
      e.preventDefault(); // Prevent default touch behavior
    };
    
    undoBtn.addEventListener('touchstart', handleUndoTouch, { passive: false });
    undoBtn.addEventListener('touchend', (e) => {
      handleUndoTouch(e);
      applyUndo();
    }, { passive: false });
  }

  // Paste button event listener
  if (pasteBtn) {
    pasteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      pasteText();
    });
    
    // Also handle touch events for mobile
    const handlePasteTouch = (e) => {
      e.stopPropagation(); // Prevent canvas from getting the touch event
      e.preventDefault(); // Prevent default touch behavior
    };
    
    pasteBtn.addEventListener('touchstart', handlePasteTouch, { passive: false });
    pasteBtn.addEventListener('touchend', (e) => {
      handlePasteTouch(e);
      pasteText();
    }, { passive: false });
  }

  // Map slider value to zoom level with center at 1.0
  // Slider range: 0.1 to 10.0, but we want 1.0 to be at the middle position (5.05)
  // Use piecewise linear mapping so slider at middle = zoom 1.0
  const sliderToZoom = (sliderValue) => {
    const min = 0.1;
    const max = 10.0;
    const center = 1.0;
    const sliderMin = 0.1;
    const sliderMax = 10.0;
    const sliderCenter = (sliderMin + sliderMax) / 2; // 5.05
    
    if (sliderValue <= sliderCenter) {
      // Map from [0.1, 5.05] to [0.1, 1.0]
      return min + (center - min) * (sliderValue - sliderMin) / (sliderCenter - sliderMin);
    } else {
      // Map from [5.05, 10.0] to [1.0, 10.0]
      return center + (max - center) * (sliderValue - sliderCenter) / (sliderMax - sliderCenter);
    }
  };
  
  const zoomToSlider = (zoomValue) => {
    const min = 0.1;
    const max = 10.0;
    const center = 1.0;
    const sliderMin = 0.1;
    const sliderMax = 10.0;
    const sliderCenter = (sliderMin + sliderMax) / 2; // 5.05
    
    if (zoomValue <= center) {
      // Map from [0.1, 1.0] to [0.1, 5.05]
      return sliderMin + (sliderCenter - sliderMin) * (zoomValue - min) / (center - min);
    } else {
      // Map from [1.0, 10.0] to [5.05, 10.0]
      return sliderCenter + (sliderMax - sliderCenter) * (zoomValue - center) / (max - center);
    }
  };

  // Zoom level slider event listener
  if (zoomLevelSlider) {
    
    const handleZoomLevelChange = (e) => {
      const sliderValue = parseFloat(e.target.value);
      const newZoom = sliderToZoom(sliderValue);
      
      // Convert cursor position to screen coordinates for zoom center
      ensureCellDimensions();
      const centerX = (cursor.col - origin.col) * CELL_W * zoom;
      const centerY = (cursor.row - origin.row) * CELL_H * zoom;
      
      setZoom(newZoom, centerX, centerY);
    };
    
    zoomLevelSlider.addEventListener('input', handleZoomLevelChange);
    zoomLevelSlider.addEventListener('change', handleZoomLevelChange);
    
    // Touch event handlers for mobile - stop propagation to prevent canvas interference
    // but don't prevent default so the slider works normally
    zoomLevelSlider.addEventListener('touchstart', (e) => {
      e.stopPropagation(); // Prevent canvas from getting the touch event
    }, { passive: false });
    
    zoomLevelSlider.addEventListener('touchmove', (e) => {
      e.stopPropagation(); // Prevent canvas from getting the touch event
    }, { passive: false });
    
    zoomLevelSlider.addEventListener('touchend', (e) => {
      e.stopPropagation(); // Prevent canvas from getting the touch event
    }, { passive: false });
    
    // Initialize slider value
    zoomLevelSlider.value = zoomToSlider(zoom);
    if (zoomLevelValue) {
      zoomLevelValue.textContent = zoom.toFixed(2);
    }
  }

  // Logarithmic mapping for zoom speed slider
  // Slider range: 0 to 1, maps to zoom speed: 0.01 to 0.25
  // Default 0.05 is at slider position 0.5 (centered)
  // Using max=0.25 ensures that slider 0.5 maps exactly to 0.05
  const sliderToZoomSpeed = (sliderValue) => {
    const min = 0.01;
    const max = 0.25; // Adjusted so that 0.5 maps to 0.05
    // Use logarithmic scale: zoomSpeed = min * (max/min)^sliderValue
    return min * Math.pow(max / min, sliderValue);
  };
  
  const zoomSpeedToSlider = (zoomSpeed) => {
    const min = 0.01;
    const max = 0.25; // Adjusted so that 0.5 maps to 0.05
    // Inverse of logarithmic: sliderValue = log(zoomSpeed/min) / log(max/min)
    return Math.log(zoomSpeed / min) / Math.log(max / min);
  };

  // Zoom speed slider event listener
  if (zoomSpeedSlider) {
    zoomSpeedSlider.addEventListener('input', (e) => {
      const sliderValue = parseFloat(e.target.value);
      ZOOM_STEP = sliderToZoomSpeed(sliderValue);
      if (zoomSpeedValue) {
        zoomSpeedValue.textContent = ZOOM_STEP.toFixed(3);
      }
    });
    
    // Also listen for change event as fallback
    zoomSpeedSlider.addEventListener('change', (e) => {
      const sliderValue = parseFloat(e.target.value);
      ZOOM_STEP = sliderToZoomSpeed(sliderValue);
      if (zoomSpeedValue) {
        zoomSpeedValue.textContent = ZOOM_STEP.toFixed(3);
      }
    });
    
    // Touch event handlers for mobile - stop propagation to prevent canvas interference
    // but don't prevent default so the slider works normally
    zoomSpeedSlider.addEventListener('touchstart', (e) => {
      e.stopPropagation(); // Prevent canvas from getting the touch event
    }, { passive: false });
    
    zoomSpeedSlider.addEventListener('touchmove', (e) => {
      e.stopPropagation(); // Prevent canvas from getting the touch event
    }, { passive: false });
    
    zoomSpeedSlider.addEventListener('touchend', (e) => {
      e.stopPropagation(); // Prevent canvas from getting the touch event
    }, { passive: false });
    
    // Initialize slider value using logarithmic mapping
    zoomSpeedSlider.value = zoomSpeedToSlider(ZOOM_STEP);
    if (zoomSpeedValue) {
      zoomSpeedValue.textContent = ZOOM_STEP.toFixed(3);
    }
  }

  // Debug menu functionality
  let debugMenuVisible = false;
  let lastKeyPressed = null;
  let lastKeyCode = null;
  let lastKeyTimestamp = null;
  let lastRawKeyCode = null;
  let lastKeyEventType = null;
  let lastEventTarget = null;
  let isComposing = false;
  let lastCompositionValue = '';
  let lastInputHadContent = false;
  let debugKeySequence = ''; // Track key sequence for secret debug code
  const DEBUG_SEQUENCE = 'debugdebugdebug';

  function updateDebugInfo() {
    if (!debugMenuVisible) return;
    
    const lastKeyEl = document.getElementById('last-key');
    const keyCodeEl = document.getElementById('key-code');
    const cursorPosEl = document.getElementById('cursor-pos');
    const mobileInputValueEl = document.getElementById('mobile-input-value');
    const lastInputValueEl = document.getElementById('last-input-value');
    const keyCodeNumEl = document.getElementById('key-code-num');
    const keyTimestampEl = document.getElementById('key-timestamp');
    const rawKeyCodeEl = document.getElementById('raw-keycode');
    const keyEventTypeEl = document.getElementById('key-event-type');
    const eventTargetEl = document.getElementById('event-target');
    const compositionStateEl = document.getElementById('composition-state');
    
    if (lastKeyEl) {
      lastKeyEl.textContent = lastKeyPressed || 'None';
    }
    if (keyCodeEl) {
      keyCodeEl.textContent = lastKeyCode || '-';
    }
    if (cursorPosEl) {
      cursorPosEl.textContent = `(${Math.round(cursor.col)}, ${Math.round(cursor.row)})`;
    }
    if (mobileInputValueEl && mobileInput) {
      mobileInputValueEl.textContent = `"${mobileInput.value}"`;
    }
    if (lastInputValueEl) {
      lastInputValueEl.textContent = `"${lastInputValue}"`;
    }
    if (keyCodeNumEl) {
      keyCodeNumEl.textContent = lastKeyPressed ? lastKeyPressed.charCodeAt(0) : '-';
    }
    if (keyTimestampEl) {
      keyTimestampEl.textContent = lastKeyTimestamp ? new Date(lastKeyTimestamp).toLocaleTimeString() : '-';
    }
    if (rawKeyCodeEl) {
      rawKeyCodeEl.textContent = lastRawKeyCode || '-';
    }
    if (keyEventTypeEl) {
      keyEventTypeEl.textContent = lastKeyEventType || '-';
    }
    if (eventTargetEl) {
      eventTargetEl.textContent = lastEventTarget || '-';
    }
    if (compositionStateEl) {
      compositionStateEl.textContent = isComposing ? 'Yes' : 'No';
    }
  }

  function toggleDebugMenu() {
    const debugMenu = document.getElementById('debug-menu');
    
    debugMenuVisible = !debugMenuVisible;
    
    if (debugMenu) {
      debugMenu.style.display = debugMenuVisible ? 'block' : 'none';
    }
    
    if (debugMenuVisible) {
      updateDebugInfo();
    }
  }

  // Debug menu toggle button (inside debug menu) still works
  const debugToggle = document.getElementById('debug-toggle');
  
  if (debugToggle) {
    debugToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      toggleDebugMenu();
    });
  }

  // Enhanced key tracking for debug menu
  function trackKeyPress(key, code, event = null) {
    lastKeyPressed = key;
    lastKeyCode = code;
    lastKeyTimestamp = Date.now();
    
    // Capture additional event information if available
    if (event) {
      lastRawKeyCode = event.keyCode || event.which || event.code;
      lastKeyEventType = event.type;
      lastEventTarget = event.target ? (event.target.id || event.target.tagName) : '-';
    }
    
    // Update debug info if menu is visible, but only update key info, not everything
    if (debugMenuVisible) {
      const lastKeyEl = document.getElementById('last-key');
      const keyCodeEl = document.getElementById('key-code');
      const keyCodeNumEl = document.getElementById('key-code-num');
      const keyTimestampEl = document.getElementById('key-timestamp');
      const rawKeyCodeEl = document.getElementById('raw-keycode');
      const keyEventTypeEl = document.getElementById('key-event-type');
      const eventTargetEl = document.getElementById('event-target');
      
      if (lastKeyEl) lastKeyEl.textContent = lastKeyPressed || 'None';
      if (keyCodeEl) keyCodeEl.textContent = lastKeyCode || '-';
      if (keyCodeNumEl) keyCodeNumEl.textContent = lastKeyPressed ? lastKeyPressed.charCodeAt(0) : '-';
      if (keyTimestampEl) keyTimestampEl.textContent = lastKeyTimestamp ? new Date(lastKeyTimestamp).toLocaleTimeString() : '-';
      if (rawKeyCodeEl) rawKeyCodeEl.textContent = lastRawKeyCode || '-';
      if (keyEventTypeEl) keyEventTypeEl.textContent = lastKeyEventType || '-';
      if (eventTargetEl) eventTargetEl.textContent = lastEventTarget || '-';
    }
  }

  // We need to modify the existing keydown handler to include key tracking
  // The existing handler is already defined above, so we'll add tracking there

  // Update debug info when cursor moves or zoom changes, but less frequently
  let debugUpdateTimeout = null;
  const originalDraw = draw;
  draw = function() {
    originalDraw();
    if (debugMenuVisible) {
      // Debounce debug updates to avoid interference
      if (debugUpdateTimeout) {
        clearTimeout(debugUpdateTimeout);
      }
      debugUpdateTimeout = setTimeout(() => {
        if (debugMenuVisible) {
          updateDebugInfo();
        }
      }, 50);
    }
  };

  connect();
})();


