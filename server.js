const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
// Configure CORS - allowed origins for Socket.io connections
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ["https://graysword.ca", "https://www.graysword.ca", "http://localhost:3000"];

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(cors());
app.use(express.json());

// Serve static files (for local development only - production uses Cloudflare Pages)
app.use(express.static(__dirname));

// Health check endpoint (moved after static files)
app.get('/health', (req, res) => {
  res.json({ 
    status: 'online', 
    message: 'Boulderingo multiplayer server is running',
    timestamp: new Date().toISOString()
  });
});

// In-memory storage for rooms
const rooms = new Map();

// Rate limiting storage
const rateLimits = new Map(); // socket.id:event → {count, resetTime}

// Input validation functions
function sanitizeName(name) {
  if (!name || typeof name !== 'string') return 'Anonymous';
  name = name.trim();
  if (name.length === 0) return 'Anonymous';
  if (name.length > 20) name = name.substring(0, 20);
  // Remove HTML tags to prevent XSS
  name = name.replace(/<[^>]*>/g, '');
  return name;
}

function validateTileIndex(tileIndex) {
  const index = parseInt(tileIndex);
  return (!isNaN(index) && index >= 0 && index < 25) ? index : null;
}

function validateMarkedArray(marked) {
  if (!Array.isArray(marked)) return [];
  if (marked.length > 25) return marked.slice(0, 25); // Limit size to prevent DoS
  return marked.filter(i => {
    const idx = parseInt(i);
    return !isNaN(idx) && idx >= 0 && idx < 25;
  });
}

const VALID_MODES = ['easy', 'hard', 'lock-out'];
function validateMode(mode) {
  return VALID_MODES.includes(mode) ? mode : 'easy';
}

// Bingo line constants
const BINGO_LINES = {
  DIAG_TL_BR: [0, 6, 12, 18, 24],
  DIAG_TR_BL: [4, 8, 12, 16, 20],
  getAllLines: function() {
    const lines = [];
    // Rows
    for (let r = 0; r < 5; r++) {
      lines.push([0, 1, 2, 3, 4].map(c => r * 5 + c));
    }
    // Cols
    for (let c = 0; c < 5; c++) {
      lines.push([0, 1, 2, 3, 4].map(r => r * 5 + c));
    }
    // Diags
    lines.push(this.DIAG_TL_BR);
    lines.push(this.DIAG_TR_BL);
    return lines;
  }
};

// Helper: Check if a marked set has a bingo
function checkBingoLines(markedSet) {
  if (markedSet.size < 5) return false;
  
  // Check rows
  for (let r = 0; r < 5; r++) {
    if ([0, 1, 2, 3, 4].every(c => markedSet.has(r * 5 + c))) return true;
  }
  
  // Check cols
  for (let c = 0; c < 5; c++) {
    if ([0, 1, 2, 3, 4].every(r => markedSet.has(r * 5 + c))) return true;
  }
  
  // Check diags
  if (BINGO_LINES.DIAG_TL_BR.every(i => markedSet.has(i))) return true;
  if (BINGO_LINES.DIAG_TR_BL.every(i => markedSet.has(i))) return true;
  
  return false;
}

// Helper: Get player list for room
function getPlayerList(room) {
  return Array.from(room.players.values()).map(p => ({
    id: p.id,
    name: p.name
  }));
}

// Helper: Normalize room code
function normalizeRoomCode(roomCode) {
  if (!roomCode || typeof roomCode !== 'string') return null;
  return roomCode.trim().toUpperCase();
}

// Helper: Validate room access
function validateRoomAccess(socket, roomCode) {
  const normalizedCode = normalizeRoomCode(roomCode);
  if (!normalizedCode) {
    return { valid: false, error: 'Invalid room code' };
  }
  
  const room = rooms.get(normalizedCode);
  if (!room) {
    return { valid: false, error: 'Room not found' };
  }
  
  if (!room.players.has(socket.id)) {
    return { valid: false, error: 'Not in room' };
  }
  
  return { valid: true, room, roomCode: normalizedCode };
}

// Helper: Create a new player object
function createPlayer(socketId, name) {
  return {
    id: socketId,
    name: name,
    marked: [],
    finished: false,
    finishTime: null
  };
}

// Helper: Send lobby state to a player
function sendLobbyState(socket, room, isHost) {
  socket.emit(isHost ? 'roomCreated' : 'roomJoined', {
    roomCode: room.code,
    mode: room.mode,
    isHost: isHost,
    players: getPlayerList(room)
  });
}

// Helper: Broadcast player list update to all players in room
function broadcastPlayerListUpdate(io, roomCode, eventName, additionalData = {}) {
  const room = rooms.get(roomCode);
  if (!room) return;
  
  io.to(roomCode).emit(eventName, {
    ...additionalData,
    players: getPlayerList(room)
  });
}

// Simple rate limiting
function checkRateLimit(socket, event, maxRequests = 30, windowMs = 10000) {
  const key = `${socket.id}:${event}`;
  const now = Date.now();
  const limit = rateLimits.get(key);
  
  if (!limit || now > limit.resetTime) {
    rateLimits.set(key, { count: 1, resetTime: now + windowMs });
    return true;
  }
  
  if (limit.count >= maxRequests) {
    return false;
  }
  
  limit.count++;
  return true;
}

// Clean up old rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, limit] of rateLimits.entries()) {
    if (now > limit.resetTime) {
      rateLimits.delete(key);
    }
  }
}, 60000); // Every minute

// Challenge pools (same as frontend)
const CHALLENGES = [
  "Pink -7 holds",
  "Yellow -5 holds",
  "Green -3 holds",
  "Bathang any hold",
  "Slab 🥰",
  "Dyno 🤮",
  "Scorpion every move",
  "Graysword Kilter 30°",
  "Sloper deadhang 5s",
  "Climb, downclimb, climb",
  "Stacked feet",
  "Facing out start",
  "Campus anything",
  "4 repeats 4 min",
  "Dropknee",
  "Heel Hook",
  "Toe Hook",
  "Kneebar",
  "Figure 4",
  "Flash x3",
  "Eyes closed",
  "Half & Half",
  "ALL Pinks b2b",
  "1 Hand only",
  "No hands on a volume"
];

const HARD_CHALLENGES = [
  "E-limb-ination",
  "Orange -1 hold",
  "Graysword Kilter 40°",
  "Campus",
  "Feet b4 hands"
];

// Generate a random 4-character room code
function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  // Ensure code doesn't already exist
  if (rooms.has(code)) {
    return generateRoomCode();
  }
  return code;
}

// Generate board (same logic as frontend)
function generateBoard(mode = 'easy') {
  const poolSource = mode === 'hard' ? [...CHALLENGES, ...HARD_CHALLENGES] : CHALLENGES;
  const validItems = poolSource.filter(item => item.trim() !== "");
  const pool = validItems.length >= 25
    ? validItems
    : [...validItems, ...Array(25 - validItems.length).fill("—")];
  
  const shuffled = [...pool].sort(() => 0.5 - Math.random());
  const board = shuffled.slice(0, 25);
  
  // Only easy mode has FREE space (lock-out and hard modes don't)
  if (mode === 'easy') {
    board[12] = 'FREE';
  }
  
  return board;
}

// Check if bingo is still possible in lock-out mode
function checkBingoPossible(room) {
  if (room.mode !== 'lock-out') return true;
  
  const lockedSet = new Set(room.lockedTiles.keys());
  const playerIds = Array.from(room.players.keys());
  
  // Get all possible bingo lines
  const lines = BINGO_LINES.getAllLines();
  
  // Check if any line can still be completed by either player
  for (const line of lines) {
    // Check if this line can be completed by player 1
    const player1Locks = line.filter(i => {
      const lock = room.lockedTiles.get(i);
      return lock && lock.playerId === playerIds[0];
    });
    const player1OpponentLocks = line.filter(i => {
      const lock = room.lockedTiles.get(i);
      return lock && lock.playerId === playerIds[1];
    });
    // Player 1 can complete if no opponent locks in this line
    if (player1OpponentLocks.length === 0) {
      return true;
    }
    
    // Check if this line can be completed by player 2
    const player2Locks = line.filter(i => {
      const lock = room.lockedTiles.get(i);
      return lock && lock.playerId === playerIds[1];
    });
    const player2OpponentLocks = line.filter(i => {
      const lock = room.lockedTiles.get(i);
      return lock && lock.playerId === playerIds[0];
    });
    // Player 2 can complete if no opponent locks in this line
    if (player2OpponentLocks.length === 0) {
      return true;
    }
  }
  
  return false; // No bingo possible
}

// Clean up empty rooms and check countdown timers periodically
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    if (room.players.size === 0) {
      // Delete empty rooms immediately
      rooms.delete(code);
      continue;
    }
    
    // Clean up old inactive rooms (1 hour of inactivity)
    const lastActivity = room.lastActivity || room.createdAt || now;
    if (now - lastActivity > 3600000) { // 1 hour
      rooms.delete(code);
      continue;
    }
    
    // Check countdown mode expiration
    if (room.mode === 'lock-out' && room.countdownMode && room.countdownEndTime) {
      if (now >= room.countdownEndTime) {
        // Countdown expired - determine winner by most tiles locked
        handleCountdownEnd(room);
      }
    }
  }
}, 1000); // Check every second

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('createRoom', ({ name, mode }) => {
    // Rate limiting
    if (!checkRateLimit(socket, 'createRoom', 5, 60000)) {
      socket.emit('createRoomError', { message: 'Too many requests. Please wait a moment.' });
      return;
    }
    
    // Validate and sanitize inputs
    name = sanitizeName(name);
    mode = validateMode(mode);
    
    const roomCode = generateRoomCode();
    
    const room = {
      code: roomCode,
      board: null, // Board not generated until game starts
      mode: mode,
      startTime: null, // Start time set when game starts
      status: 'lobby', // 'lobby' or 'in-game'
      hostId: socket.id, // Track who created the room
      players: new Map(),
      leaderboard: [],
      // Lock-out mode specific
      lockedTiles: new Map(), // tileIndex → {playerId, playerName, timestamp}
      lockHistory: [], // Array of {tileIndex, playerId, playerName, timestamp, challenge}
      countdownMode: false,
      countdownEndTime: null,
      createdAt: Date.now(),
      lastActivity: Date.now()
    };
    
    room.players.set(socket.id, createPlayer(socket.id, name));
    
    rooms.set(roomCode, room);
    socket.join(roomCode);
    
    // Send lobby state to creator
    sendLobbyState(socket, room, true);
    
    console.log(`Room ${roomCode} created by ${name} (lobby)`);
  });

  socket.on('joinRoom', ({ roomCode, name }) => {
    // Rate limiting
    if (!checkRateLimit(socket, 'joinRoom', 10, 60000)) {
      socket.emit('joinError', { message: 'Too many requests. Please wait a moment.' });
      return;
    }
    
    // Validate and sanitize inputs
    name = sanitizeName(name);
    const normalizedCode = normalizeRoomCode(roomCode);
    if (!normalizedCode) {
      socket.emit('joinError', { message: 'Invalid room code' });
      return;
    }
    
    // Upercase and trimmed
    const room = rooms.get(normalizedCode);
    if (!room) {
      socket.emit('joinError', { message: 'Room not found' });
      return;
    }
    
    // Update last activity
    room.lastActivity = Date.now();
    
    // Check if game has already started - allow rejoin if player was already in room
    if (room.status === 'in-game') {
      // Check if player was already in the room (by name)
      const existingPlayer = Array.from(room.players.values()).find(p => p.name === name);
      if (existingPlayer) {
        // Player was in the room - allow rejoin
        // Remove old socket.id entry and add new one
        room.players.delete(existingPlayer.id);
        room.players.set(socket.id, {
          id: socket.id,
          name: name,
          marked: existingPlayer.marked, // Preserve their marked tiles
          finished: existingPlayer.finished,
          finishTime: existingPlayer.finishTime
        });
        
        socket.join(normalizedCode);
        
        // Send current game state
        socket.emit('gameRejoined', {
          roomCode: normalizedCode,
          board: room.board,
          mode: room.mode,
          startTime: room.startTime,
          marked: existingPlayer.marked,
          lockedTiles: room.mode === 'lock-out' ? Object.fromEntries(room.lockedTiles) : null,
          lockCounts: room.mode === 'lock-out' ? getLockCounts(room) : null,
          countdownMode: room.mode === 'lock-out' ? room.countdownMode : false,
          countdownEndTime: room.mode === 'lock-out' ? room.countdownEndTime : null,
          leaderboard: room.leaderboard || []
        });
        
        // Notify other players
        broadcastPlayerListUpdate(io, normalizedCode, 'playerRejoined', { name: name });
        
        console.log(`${name} rejoined room ${normalizedCode} (in-game)`);
        return;
      } else {
        // New player trying to join active game - block it
        socket.emit('joinError', { message: 'Game has already started' });
        return;
      }
    }
    
    // Lock-out mode: only allow 2 players
    if (room.mode === 'lock-out' && room.players.size >= 2) {
      socket.emit('joinError', { message: 'Lock-out mode is limited to 2 players' });
      return;
    }
    
    // Check if player already in room (by socket.id)
    if (room.players.has(socket.id)) {
      socket.emit('joinError', { message: 'Already in this room' });
      return;
    }
    
    room.players.set(socket.id, createPlayer(socket.id, name));
    socket.join(normalizedCode);
    
    // Send lobby state to joiner
    sendLobbyState(socket, room, false);
    
    // Notify all players in room about the new player
    broadcastPlayerListUpdate(io, normalizedCode, 'playerJoined', { name: name });
    
    console.log(`${name} joined room ${normalizedCode} (lobby)`);
  });

  socket.on('startGame', ({ roomCode }) => {
    // Rate limiting
    if (!checkRateLimit(socket, 'startGame', 5, 60000)) {
      socket.emit('startGameError', { message: 'Too many requests. Please wait a moment.' });
      return;
    }
    
    // Validate room code and access
    const validation = validateRoomAccess(socket, roomCode);
    if (!validation.valid) {
      socket.emit('startGameError', { message: validation.error });
      return;
    }
    const { room, roomCode: normalizedCode } = validation;
    
    // Update last activity
    room.lastActivity = Date.now();
    
    // Only host can start the game
    if (room.hostId !== socket.id) {
      socket.emit('startGameError', { message: 'Only the host can start the game' });
      return;
    }
    
    // Check if game already started
    if (room.status === 'in-game') {
      socket.emit('startGameError', { message: 'Game has already started' });
      return;
    }
    
    // Lock-out mode: must have exactly 2 players
    if (room.mode === 'lock-out' && room.players.size !== 2) {
      socket.emit('startGameError', { message: 'Lock-out mode requires exactly 2 players' });
      return;
    }
    
    // Generate board and start time
    room.board = generateBoard(room.mode);
    room.startTime = Date.now();
    room.status = 'in-game';
    
    // Reset all players' game state
    room.players.forEach(player => {
      player.marked = [];
      player.finished = false;
      player.finishTime = null;
    });
    room.leaderboard = [];
    
    // Initialize lock-out mode data
    if (room.mode === 'lock-out') {
      room.lockedTiles = new Map();
      room.lockHistory = [];
      room.countdownMode = false;
      room.countdownEndTime = null;
    }
    
    // Broadcast game start to all players in room simultaneously
    io.to(normalizedCode).emit('gameStarted', {
      roomCode: normalizedCode,
      board: room.board,
      mode: room.mode,
      startTime: room.startTime
    });
    
    console.log(`Game started in room ${normalizedCode} by host`);
  });

  socket.on('updateMarked', ({ roomCode, marked }) => {
    // Rate limiting
    if (!checkRateLimit(socket, 'updateMarked', 30, 10000)) {
      return; // Silently ignore if rate limited
    }
    
    // Validate inputs
    marked = validateMarkedArray(marked);
    const validation = validateRoomAccess(socket, roomCode);
    if (!validation.valid) return;
    const { room } = validation;
    
    // Update last activity
    room.lastActivity = Date.now();
    
    // Only allow updates if game has started
    if (room.status !== 'in-game') return;
    
    // Skip updateMarked for lock-out mode (use lockTile instead)
    if (room.mode === 'lock-out') return;
    
    const player = room.players.get(socket.id);
    player.marked = marked;
    
    // Broadcast to other players (optional - if you want to see others' progress)
    // socket.to(roomCode).emit('playerProgress', {
    //   playerId: socket.id,
    //   playerName: player.name,
    //   markedCount: marked.length
    // });
  });

  socket.on('lockTile', ({ roomCode, tileIndex }) => {
    // Rate limiting
    if (!checkRateLimit(socket, 'lockTile', 30, 10000)) {
      socket.emit('lockTileError', { message: 'Too many requests. Please wait a moment.' });
      return;
    }
    
    // Validate inputs
    const index = validateTileIndex(tileIndex);
    if (index === null) {
      socket.emit('lockTileError', { message: 'Invalid tile index' });
      return;
    }
    
    const validation = validateRoomAccess(socket, roomCode);
    if (!validation.valid) {
      socket.emit('lockTileError', { message: validation.error });
      return;
    }
    const { room, roomCode: normalizedCode } = validation;
    
    // Update last activity
    room.lastActivity = Date.now();
    
    // Only allow in lock-out mode
    if (room.mode !== 'lock-out') {
      socket.emit('lockTileError', { message: 'Not in lock-out mode' });
      return;
    }
    
    // Only allow if game has started
    if (room.status !== 'in-game') {
      socket.emit('lockTileError', { message: 'Game has not started yet' });
      return;
    }
    
    const player = room.players.get(socket.id);
    if (player.finished) {
      socket.emit('lockTileError', { message: 'Game already finished' });
      return;
    }
    
    // Check if tile is already locked
    if (room.lockedTiles.has(index)) {
      socket.emit('lockTileError', { message: 'Tile already locked' });
      return;
    }
    
    // Check if tile is FREE (only in easy mode, but lock-out uses hard mode so this is defensive)
    // Note: Lock-out mode doesn't generate FREE spaces, but this check prevents edge cases
    if (room.board[index] === 'FREE') {
      socket.emit('lockTileError', { message: 'Cannot lock FREE space' });
      return;
    }
    
    // Lock the tile
    const timestamp = Date.now();
    const lockData = {
      playerId: socket.id,
      playerName: player.name,
      timestamp: timestamp
    };
    room.lockedTiles.set(index, lockData);
    
    // Add to lock history
    room.lockHistory.push({
      tileIndex: index,
      playerId: socket.id,
      playerName: player.name,
      timestamp: timestamp,
      challenge: room.board[index],
      elapsedMs: timestamp - room.startTime
    });
    
    // Update player's marked array for bingo checking
    if (!player.marked.includes(index)) {
      player.marked.push(index);
    }
    
    // Broadcast tile locked to all players
    io.to(normalizedCode).emit('tileLocked', {
      tileIndex: index,
      playerId: socket.id,
      playerName: player.name,
      timestamp: timestamp,
      lockedTiles: Object.fromEntries(room.lockedTiles),
      lockCounts: getLockCounts(room)
    });
    
    // Auto-check for bingo
    checkLockOutBingo(room, player, socket);
    
    // Check if bingo is still possible, enter countdown mode if not
    if (!checkBingoPossible(room)) {
      if (!room.countdownMode) {
        // Enter countdown mode
        room.countdownMode = true;
        room.countdownEndTime = Date.now() + 120000; // 2 minutes
        io.to(normalizedCode).emit('countdownModeStarted', {
          endTime: room.countdownEndTime
        });
      } else {
        // Refresh countdown (2 minutes from now)
        room.countdownEndTime = Date.now() + 120000;
        io.to(normalizedCode).emit('countdownRefreshed', {
          endTime: room.countdownEndTime
        });
      }
    }
    
    console.log(`${player.name} locked tile ${tileIndex} in room ${normalizedCode}`);
  });
  
  function getLockCounts(room) {
    const counts = {};
    room.players.forEach((player, playerId) => {
      counts[playerId] = Array.from(room.lockedTiles.values()).filter(
        lock => lock.playerId === playerId
      ).length;
    });
    return counts;
  }
  
  function checkLockOutBingo(room, player, socket) {
    if (player.finished) return;
    
    // Check for bingo using player's marked tiles
    const markedSet = new Set(player.marked);
    if (checkBingoLines(markedSet)) {
      handleLockOutBingo(room, player, socket);
    }
  }
  
  function handleLockOutBingo(room, player, socket) {
    const finishTime = Date.now();
    const elapsedMs = finishTime - room.startTime;
    
    player.finished = true;
    player.finishTime = finishTime;
    player.elapsedMs = elapsedMs;
    
    // End countdown mode if active
    room.countdownMode = false;
    
    // Broadcast win to all players
    io.to(room.code).emit('lockOutWin', {
      winnerId: socket.id,
      winnerName: player.name,
      elapsedMs: elapsedMs,
      lockHistory: room.lockHistory,
      winType: 'bingo'
    });
    
    console.log(`${player.name} won lock-out in room ${room.code}`);
  }
  
  function handleCountdownEnd(room) {
    room.countdownMode = false;
    room.status = 'finished';
    
    // Count tiles locked by each player
    const lockCounts = getLockCounts(room);
    const playerIds = Array.from(room.players.keys());
    const player1Count = lockCounts[playerIds[0]] || 0;
    const player2Count = lockCounts[playerIds[1]] || 0;
    
    let winnerId, winnerName, winType;
    if (player1Count > player2Count) {
      winnerId = playerIds[0];
      winnerName = room.players.get(playerIds[0]).name;
      winType = 'most_tiles';
    } else if (player2Count > player1Count) {
      winnerId = playerIds[1];
      winnerName = room.players.get(playerIds[1]).name;
      winType = 'most_tiles';
    } else {
      // Tie - could be first to lock, or just declare tie
      winnerId = null;
      winnerName = 'Tie';
      winType = 'tie';
    }
    
    // Mark players as finished
    room.players.forEach(player => {
      player.finished = true;
    });
    
    // Broadcast countdown end result
    io.to(room.code).emit('countdownEnded', {
      winnerId: winnerId,
      winnerName: winnerName,
      lockCounts: lockCounts,
      lockHistory: room.lockHistory,
      winType: winType
    });
    
    console.log(`Countdown ended in room ${room.code}, winner: ${winnerName}`);
  }

  socket.on('verifyBingo', ({ roomCode, marked }) => {
    // Rate limiting
    if (!checkRateLimit(socket, 'verifyBingo', 10, 10000)) {
      socket.emit('verifyResult', { valid: false, message: 'Too many requests' });
      return;
    }
    
    // Validate inputs
    marked = validateMarkedArray(marked);
    const validation = validateRoomAccess(socket, roomCode);
    if (!validation.valid) {
      socket.emit('verifyResult', { valid: false, message: validation.error });
      return;
    }
    const { room } = validation;
    
    // Update last activity
    room.lastActivity = Date.now();
    
    // Only allow verification if game has started
    if (room.status !== 'in-game') {
      socket.emit('verifyResult', { valid: false, message: 'Game has not started yet' });
      return;
    }
    
    const player = room.players.get(socket.id);
    if (player.finished) {
      socket.emit('verifyResult', { valid: false, message: 'Already finished' });
      return;
    }
    
    // Check for bingo
    const markedSet = new Set(marked);
    if (checkBingoLines(markedSet)) {
      handleBingo(room, player, socket);
    } else {
      socket.emit('verifyResult', { valid: false });
    }
  });

  function handleBingo(room, player, socket) {
    const finishTime = Date.now();
    const elapsedMs = finishTime - room.startTime;
    
    player.finished = true;
    player.finishTime = finishTime;
    player.elapsedMs = elapsedMs;
    
    // Add to leaderboard
    room.leaderboard.push({
      name: player.name,
      elapsedMs: elapsedMs,
      finishTime: finishTime
    });
    
    // Sort leaderboard by time
    room.leaderboard.sort((a, b) => a.elapsedMs - b.elapsedMs);
    
    socket.emit('verifyResult', {
      valid: true,
      elapsedMs: elapsedMs,
      position: room.leaderboard.findIndex(e => e.name === player.name) + 1
    });
    
    // Broadcast to all players in room
    io.to(room.code).emit('leaderboardUpdate', {
      leaderboard: room.leaderboard.map((entry, index) => ({
        position: index + 1,
        name: entry.name,
        elapsedMs: entry.elapsedMs
      }))
    });
    
    console.log(`${player.name} finished in room ${room.code} with time ${elapsedMs}ms`);
  }

  socket.on('disconnect', () => {
    // Remove player from rooms
    for (const [code, room] of rooms.entries()) {
      if (room.players.has(socket.id)) {
        const player = room.players.get(socket.id);
        room.players.delete(socket.id);
        
        // If host left and game hasn't started, assign new host
        if (room.hostId === socket.id && room.status === 'lobby' && room.players.size > 0) {
          // Assign first remaining player as new host
          const newHostId = Array.from(room.players.keys())[0];
          room.hostId = newHostId;
          // Notify new host
          io.to(newHostId).emit('hostChanged', { isHost: true });
        }
        
        // Notify other players
        broadcastPlayerListUpdate(io, code, 'playerLeft', { name: player.name });
        
        // Clean up empty rooms
        if (room.players.size === 0) {
          rooms.delete(code);
        }
      }
    }
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

