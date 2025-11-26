// ============================================
// IMPORTS & SETUP
// ============================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// ============================================
// CONSTANTS & CONFIG
// ============================================

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

const VALID_MODES = ['easy', 'hard', 'lock-out', 'lock-out-easy', 'lock-out-hard'];
const VALID_GRADES = ['pink', 'yellow', 'green', 'orange', 'blue'];

const CHALLENGES = [
  "Pink tag -7 holds",
  "Yellow tag -5 holds",
  "Green tag -3 holds",
  "Bathang any hold",
  "Slab 🥰",
  "Dyno 🤮",
  "Scorpion every move",
  "Graysword Kilter 30°",
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
  "1 Hand only",
  "No hands on a volume"
];

const HARD_CHALLENGES = [
  "E-limb-ination",
  "Orange tag -1 hold",
  "Graysword Kilter 40°",
  "Campus",
  "Feet b4 hands"
];

const BINGO_LINES = {
  DIAG_TL_BR: [0, 6, 12, 18, 24],
  DIAG_TR_BL: [4, 8, 12, 16, 20],
  getAllLines: function() {
    const lines = [];
    for (let r = 0; r < 5; r++) {
      lines.push([0, 1, 2, 3, 4].map(c => r * 5 + c));
    }
    for (let c = 0; c < 5; c++) {
      lines.push([0, 1, 2, 3, 4].map(r => r * 5 + c));
    }
    lines.push(this.DIAG_TL_BR);
    lines.push(this.DIAG_TR_BL);
    return lines;
  }
};

// ============================================
// STATE
// ============================================

const rooms = new Map();
const rateLimits = new Map();

// ============================================
// VALIDATION & SANITIZATION
// ============================================

function sanitizeName(name) {
  if (!name || typeof name !== 'string') return 'Anonymous';
  
  name = name.replace(/<[^>]*>/g, '');
  name = name.replace(/[<>]/g, '');
  name = name.trim();
  
  if (name.length === 0) return 'Anonymous';
  if (name.length > 20) name = name.substring(0, 20);
  
  return name;
}

function validateAndSanitizeName(socket, name, errorEvent) {
  name = sanitizeName(name);
  if (!name || name.trim().length === 0 || name === 'Anonymous') {
    emitError(socket, errorEvent, 'Please enter a valid name');
    return null;
  }
  return name;
}

function validateTileIndex(tileIndex) {
  const index = parseInt(tileIndex);
  return (!isNaN(index) && index >= 0 && index < 25) ? index : null;
}

function validateMarkedArray(marked) {
  if (!Array.isArray(marked)) return [];
  if (marked.length > 25) return marked.slice(0, 25);
  return marked.filter(i => {
    const idx = parseInt(i);
    return !isNaN(idx) && idx >= 0 && idx < 25;
  });
}

function validateMode(mode) {
  return VALID_MODES.includes(mode) ? mode : 'easy';
}

function validateMinGrade(minGrade) {
  return VALID_GRADES.includes(minGrade) ? minGrade : 'green';
}

// ============================================
// MODE HELPERS
// ============================================

function isLockOutMode(mode) {
  return mode === 'lock-out' || mode === 'lock-out-easy' || mode === 'lock-out-hard';
}

function getBaseMode(mode) {
  if (mode === 'lock-out-easy') return 'easy';
  if (mode === 'lock-out-hard') return 'hard';
  if (mode === 'lock-out') return 'easy';
  return mode;
}

// ============================================
// ROOM HELPERS
// ============================================

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  if (rooms.has(code)) {
    return generateRoomCode();
  }
  return code;
}

function normalizeRoomCode(roomCode) {
  if (!roomCode || typeof roomCode !== 'string') return null;
  return roomCode.trim().toUpperCase();
}

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

function createPlayer(socketId, name) {
  return {
    id: socketId,
    name: name,
    marked: [],
    finished: false,
    finishTime: null
  };
}

function updateRoomActivity(room) {
  room.lastActivity = Date.now();
}

function initializeLockOutRoom(room) {
  room.lockedTiles = new Map();
  room.lockHistory = [];
  room.countdownMode = false;
  room.countdownEndTime = null;
}

function resetPlayerGameState(room) {
  room.players.forEach(player => {
    player.marked = [];
    player.finished = false;
    player.finishTime = null;
  });
  room.leaderboard = [];
}

// ============================================
// BOARD GENERATION
// ============================================

function generateBoard(mode = 'easy', minGrade = 'green') {
  const baseMode = getBaseMode(mode);
  
  let poolSource = baseMode === 'hard' ? [...CHALLENGES, ...HARD_CHALLENGES] : [...CHALLENGES];
  
  if (minGrade !== 'pink') {
    const pinksChallenge = baseMode === 'hard' ? "10 Pinks b2b" : "5 Pinks b2b";
    poolSource.push(pinksChallenge);
  }
  
  const sloperChallenge = baseMode === 'hard' ? "Sloper deadhang 10s" : "Sloper deadhang 5s";
  poolSource.push(sloperChallenge);
  
  const validItems = poolSource.filter(item => item.trim() !== "" && item !== "—");
  const pool = validItems;
  
  const shuffled = [...pool].sort(() => 0.5 - Math.random());
  const board = shuffled.slice(0, Math.min(25, shuffled.length));
  
  if (baseMode === 'easy' && !isLockOutMode(mode)) {
    board[12] = 'FREE';
  }
  
  return board;
}

// ============================================
// BINGO LOGIC
// ============================================

function checkBingoLines(markedSet) {
  if (markedSet.size < 5) return false;
  
  for (let r = 0; r < 5; r++) {
    if ([0, 1, 2, 3, 4].every(c => markedSet.has(r * 5 + c))) return true;
  }
  
  for (let c = 0; c < 5; c++) {
    if ([0, 1, 2, 3, 4].every(r => markedSet.has(r * 5 + c))) return true;
  }
  
  if (BINGO_LINES.DIAG_TL_BR.every(i => markedSet.has(i))) return true;
  if (BINGO_LINES.DIAG_TR_BL.every(i => markedSet.has(i))) return true;
  
  return false;
}

function checkBingoPossible(room) {
  if (!isLockOutMode(room.mode)) return true;
  
  const playerIds = Array.from(room.players.keys());
  const lines = BINGO_LINES.getAllLines();
  
  for (const line of lines) {
    const player1OpponentLocks = line.filter(i => {
      const lock = room.lockedTiles.get(i);
      return lock && lock.playerId === playerIds[1];
    });
    if (player1OpponentLocks.length === 0) {
      return true;
    }
    
    const player2OpponentLocks = line.filter(i => {
      const lock = room.lockedTiles.get(i);
      return lock && lock.playerId === playerIds[0];
    });
    if (player2OpponentLocks.length === 0) {
      return true;
    }
  }
  
  return false;
}

// ============================================
// RATE LIMITING
// ============================================

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

function handleRateLimitError(socket, event, errorEvent, message = 'Too many requests. Please wait a moment.') {
  emitError(socket, errorEvent, message);
}

// ============================================
// ERROR HANDLING
// ============================================

function emitError(socket, event, message) {
  socket.emit(event, { message });
}

// ============================================
// GAME STATE HELPERS
// ============================================

function validateGameStarted(room, socket, errorEvent) {
  if (room.status !== 'in-game') {
    emitError(socket, errorEvent, 'Game has not started yet');
    return false;
  }
  return true;
}

function validateLockOutMode(room, socket, errorEvent) {
  if (!isLockOutMode(room.mode)) {
    emitError(socket, errorEvent, 'Not in lock-out mode');
    return false;
  }
  return true;
}

function getPlayerList(room) {
  return Array.from(room.players.values()).map(p => ({
    id: p.id,
    name: p.name
  }));
}

function getLockCounts(room) {
  const counts = {};
  room.players.forEach((player, playerId) => {
    counts[playerId] = Array.from(room.lockedTiles.values()).filter(
      lock => lock.playerId === playerId
    ).length;
  });
  return counts;
}

function getGameRejoinData(room, player) {
  return {
    roomCode: room.code,
    board: room.board,
    mode: room.mode,
    minGrade: room.minGrade,
    startTime: room.startTime,
    marked: player.marked,
    lockedTiles: isLockOutMode(room.mode) ? Object.fromEntries(room.lockedTiles) : null,
    lockCounts: isLockOutMode(room.mode) ? getLockCounts(room) : null,
    countdownMode: isLockOutMode(room.mode) ? room.countdownMode : false,
    countdownEndTime: isLockOutMode(room.mode) ? room.countdownEndTime : null,
    leaderboard: room.leaderboard || []
  };
}

// ============================================
// GAME EVENT HANDLERS
// ============================================

function checkLockOutBingo(room, player, socket) {
  if (player.finished) return;
  
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
  room.countdownMode = false;
  
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
    winnerId = null;
    winnerName = 'Tie';
    winType = 'tie';
  }
  
  room.players.forEach(player => {
    player.finished = true;
  });
  
  io.to(room.code).emit('countdownEnded', {
    winnerId: winnerId,
    winnerName: winnerName,
    lockCounts: lockCounts,
    lockHistory: room.lockHistory,
    winType: winType
  });
  
  console.log(`Countdown ended in room ${room.code}, winner: ${winnerName}`);
}

function handleBingo(room, player, socket) {
  const finishTime = Date.now();
  const elapsedMs = finishTime - room.startTime;
  
  player.finished = true;
  player.finishTime = finishTime;
  player.elapsedMs = elapsedMs;
  
  room.leaderboard.push({
    name: player.name,
    elapsedMs: elapsedMs,
    finishTime: finishTime
  });
  
  room.leaderboard.sort((a, b) => a.elapsedMs - b.elapsedMs);
  
  socket.emit('verifyResult', {
    valid: true,
    elapsedMs: elapsedMs,
    position: room.leaderboard.findIndex(e => e.name === player.name) + 1
  });
  
  io.to(room.code).emit('leaderboardUpdate', {
    leaderboard: room.leaderboard.map((entry, index) => ({
      position: index + 1,
      name: entry.name,
      elapsedMs: entry.elapsedMs
    }))
  });
  
  console.log(`${player.name} finished in room ${room.code} with time ${elapsedMs}ms`);
}

// ============================================
// SOCKET COMMUNICATION
// ============================================

function sendLobbyState(socket, room, isHost) {
  socket.emit(isHost ? 'roomCreated' : 'roomJoined', {
    roomCode: room.code,
    mode: room.mode,
    minGrade: room.minGrade || 'green',
    isHost: isHost,
    players: getPlayerList(room)
  });
}

function broadcastPlayerListUpdate(io, roomCode, eventName, additionalData = {}) {
  const room = rooms.get(roomCode);
  if (!room) return;
  
  io.to(roomCode).emit(eventName, {
    ...additionalData,
    players: getPlayerList(room)
  });
}

// ============================================
// EXPRESS SETUP
// ============================================

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.get('/health', (req, res) => {
  res.json({ 
    status: 'online', 
    message: 'Boulderingo multiplayer server is running',
    timestamp: new Date().toISOString()
  });
});

// ============================================
// SOCKET.IO EVENT HANDLERS
// ============================================

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // ============================================
  // ROOM MANAGEMENT
  // ============================================

  socket.on('createRoom', ({ name, mode, minGrade }) => {
    if (!checkRateLimit(socket, 'createRoom', 5, 60000)) {
      handleRateLimitError(socket, 'createRoom', 'createRoomError');
      return;
    }
    
    name = validateAndSanitizeName(socket, name, 'createRoomError');
    if (!name) return;
    
    mode = validateMode(mode);
    minGrade = validateMinGrade(minGrade);
    
    const roomCode = generateRoomCode();
    
    const room = {
      code: roomCode,
      board: null,
      mode: mode,
      minGrade: minGrade,
      startTime: null,
      status: 'lobby',
      hostId: socket.id,
      players: new Map(),
      leaderboard: [],
      lockedTiles: new Map(),
      lockHistory: [],
      countdownMode: false,
      countdownEndTime: null,
      createdAt: Date.now(),
      lastActivity: Date.now()
    };
    
    room.players.set(socket.id, createPlayer(socket.id, name));
    rooms.set(roomCode, room);
    socket.join(roomCode);
    
    sendLobbyState(socket, room, true);
    console.log(`Room ${roomCode} created by ${name} (lobby, mode: ${mode}, minGrade: ${minGrade})`);
  });

  socket.on('joinRoom', ({ roomCode, name }) => {
    if (!checkRateLimit(socket, 'joinRoom', 10, 60000)) {
      handleRateLimitError(socket, 'joinRoom', 'joinError');
      return;
    }
    
    name = validateAndSanitizeName(socket, name, 'joinError');
    if (!name) return;
    
    const normalizedCode = normalizeRoomCode(roomCode);
    if (!normalizedCode) {
      emitError(socket, 'joinError', 'Invalid room code');
      return;
    }
    
    const room = rooms.get(normalizedCode);
    if (!room) {
      emitError(socket, 'joinError', 'Room not found');
      return;
    }
    
    updateRoomActivity(room);
    
    if (room.status === 'in-game') {
      const existingPlayer = Array.from(room.players.values()).find(p => p.name === name);
      if (existingPlayer) {
        room.players.delete(existingPlayer.id);
        room.players.set(socket.id, {
          id: socket.id,
          name: name,
          marked: existingPlayer.marked,
          finished: existingPlayer.finished,
          finishTime: existingPlayer.finishTime
        });
        
        socket.join(normalizedCode);
        socket.emit('gameRejoined', getGameRejoinData(room, room.players.get(socket.id)));
        broadcastPlayerListUpdate(io, normalizedCode, 'playerRejoined', { name: name });
        console.log(`${name} rejoined room ${normalizedCode} (in-game)`);
        return;
      } else {
        emitError(socket, 'joinError', 'Game has already started');
        return;
      }
    }
    
    if (isLockOutMode(room.mode) && room.players.size >= 2) {
      emitError(socket, 'joinError', 'Lock-out mode is limited to 2 players');
      return;
    }
    
    if (room.players.has(socket.id)) {
      emitError(socket, 'joinError', 'Already in this room');
      return;
    }
    
    room.players.set(socket.id, createPlayer(socket.id, name));
    socket.join(normalizedCode);
    
    sendLobbyState(socket, room, false);
    broadcastPlayerListUpdate(io, normalizedCode, 'playerJoined', { name: name });
    console.log(`${name} joined room ${normalizedCode} (lobby)`);
  });

  // ============================================
  // GAME ACTIONS
  // ============================================

  socket.on('startGame', ({ roomCode }) => {
    if (!checkRateLimit(socket, 'startGame', 5, 60000)) {
      handleRateLimitError(socket, 'startGame', 'startGameError');
      return;
    }
    
    const validation = validateRoomAccess(socket, roomCode);
    if (!validation.valid) {
      emitError(socket, 'startGameError', validation.error);
      return;
    }
    const { room, roomCode: normalizedCode } = validation;
    
    updateRoomActivity(room);
    
    if (room.hostId !== socket.id) {
      emitError(socket, 'startGameError', 'Only the host can start the game');
      return;
    }
    
    if (room.status === 'in-game') {
      emitError(socket, 'startGameError', 'Game has already started');
      return;
    }
    
    if (isLockOutMode(room.mode) && room.players.size !== 2) {
      emitError(socket, 'startGameError', 'Lock-out mode requires exactly 2 players');
      return;
    }
    
    room.board = generateBoard(room.mode, room.minGrade || 'green');
    room.startTime = Date.now();
    room.status = 'in-game';
    
    resetPlayerGameState(room);
    
    if (isLockOutMode(room.mode)) {
      initializeLockOutRoom(room);
    }
    
    io.to(normalizedCode).emit('gameStarted', {
      roomCode: normalizedCode,
      board: room.board,
      mode: room.mode,
      startTime: room.startTime,
      minGrade: room.minGrade
    });
    
    console.log(`Game started in room ${normalizedCode} by host`);
  });

  socket.on('updateMarked', ({ roomCode, marked }) => {
    if (!checkRateLimit(socket, 'updateMarked', 30, 10000)) {
      return;
    }
    
    marked = validateMarkedArray(marked);
    const validation = validateRoomAccess(socket, roomCode);
    if (!validation.valid) return;
    const { room } = validation;
    
    updateRoomActivity(room);
    
    if (room.status !== 'in-game') return;
    if (isLockOutMode(room.mode)) return;
    
    const player = room.players.get(socket.id);
    player.marked = marked;
  });

  socket.on('verifyBingo', ({ roomCode, marked }) => {
    if (!checkRateLimit(socket, 'verifyBingo', 10, 10000)) {
      emitError(socket, 'verifyResult', 'Too many requests');
      return;
    }
    
    marked = validateMarkedArray(marked);
    const validation = validateRoomAccess(socket, roomCode);
    if (!validation.valid) {
      socket.emit('verifyResult', { valid: false, message: validation.error });
      return;
    }
    const { room } = validation;
    
    updateRoomActivity(room);
    
    if (!validateGameStarted(room, socket, 'verifyResult')) return;
    
    const player = room.players.get(socket.id);
    if (player.finished) {
      socket.emit('verifyResult', { valid: false, message: 'Already finished' });
      return;
    }
    
    const markedSet = new Set(marked);
    if (checkBingoLines(markedSet)) {
      handleBingo(room, player, socket);
    } else {
      socket.emit('verifyResult', { valid: false });
    }
  });

  // ============================================
  // LOCK-OUT MODE
  // ============================================

  socket.on('lockTile', ({ roomCode, tileIndex }) => {
    if (!checkRateLimit(socket, 'lockTile', 30, 10000)) {
      handleRateLimitError(socket, 'lockTile', 'lockTileError');
      return;
    }
    
    const index = validateTileIndex(tileIndex);
    if (index === null) {
      emitError(socket, 'lockTileError', 'Invalid tile index');
      return;
    }
    
    const validation = validateRoomAccess(socket, roomCode);
    if (!validation.valid) {
      emitError(socket, 'lockTileError', validation.error);
      return;
    }
    const { room, roomCode: normalizedCode } = validation;
    
    updateRoomActivity(room);
    
    if (!validateLockOutMode(room, socket, 'lockTileError')) return;
    if (!validateGameStarted(room, socket, 'lockTileError')) return;
    
    const player = room.players.get(socket.id);
    if (player.finished) {
      emitError(socket, 'lockTileError', 'Game already finished');
      return;
    }
    
    if (room.lockedTiles.has(index)) {
      emitError(socket, 'lockTileError', 'Tile already locked');
      return;
    }
    
    if (room.board[index] === 'FREE') {
      emitError(socket, 'lockTileError', 'Cannot lock FREE space');
      return;
    }
    
    const timestamp = Date.now();
    const lockData = {
      playerId: socket.id,
      playerName: player.name,
      timestamp: timestamp
    };
    room.lockedTiles.set(index, lockData);
    
    room.lockHistory.push({
      tileIndex: index,
      playerId: socket.id,
      playerName: player.name,
      timestamp: timestamp,
      challenge: room.board[index],
      elapsedMs: timestamp - room.startTime
    });
    
    if (!player.marked.includes(index)) {
      player.marked.push(index);
    }
    
    io.to(normalizedCode).emit('tileLocked', {
      tileIndex: index,
      playerId: socket.id,
      playerName: player.name,
      timestamp: timestamp,
      lockedTiles: Object.fromEntries(room.lockedTiles),
      lockCounts: getLockCounts(room)
    });
    
    checkLockOutBingo(room, player, socket);
    
    if (!checkBingoPossible(room)) {
      if (!room.countdownMode) {
        room.countdownMode = true;
        room.countdownEndTime = Date.now() + 120000;
        io.to(normalizedCode).emit('countdownModeStarted', {
          endTime: room.countdownEndTime
        });
      } else {
        room.countdownEndTime = Date.now() + 120000;
        io.to(normalizedCode).emit('countdownRefreshed', {
          endTime: room.countdownEndTime
        });
      }
    }
    
    console.log(`${player.name} locked tile ${tileIndex} in room ${normalizedCode}`);
  });

  // ============================================
  // CLEANUP
  // ============================================

  socket.on('disconnect', () => {
    for (const [code, room] of rooms.entries()) {
      if (room.players.has(socket.id)) {
        const player = room.players.get(socket.id);
        room.players.delete(socket.id);
        
        if (room.hostId === socket.id && room.status === 'lobby' && room.players.size > 0) {
          const newHostId = Array.from(room.players.keys())[0];
          room.hostId = newHostId;
          io.to(newHostId).emit('hostChanged', { isHost: true });
        }
        
        broadcastPlayerListUpdate(io, code, 'playerLeft', { name: player.name });
        
        if (room.players.size === 0) {
          rooms.delete(code);
        }
      }
    }
    console.log('User disconnected:', socket.id);
  });
});

// ============================================
// PERIODIC TASKS
// ============================================

setInterval(() => {
  const now = Date.now();
  for (const [key, limit] of rateLimits.entries()) {
    if (now > limit.resetTime) {
      rateLimits.delete(key);
    }
  }
}, 60000);

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    if (room.players.size === 0) {
      rooms.delete(code);
      continue;
    }
    
    const lastActivity = room.lastActivity || room.createdAt || now;
    if (now - lastActivity > 3600000) {
      rooms.delete(code);
      continue;
    }
    
    if (isLockOutMode(room.mode) && room.countdownMode && room.countdownEndTime) {
      if (now >= room.countdownEndTime) {
        handleCountdownEnd(room);
      }
    }
  }
}, 1000);

// ============================================
// SERVER STARTUP
// ============================================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
