const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
// Configure CORS - update with your frontend domain in production
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ["https://graysword.ca", "https://www.graysword.ca", "http://localhost:3000", "*"]; // Allow frontend domain and localhost

const io = new Server(server, {
  cors: {
    origin: allowedOrigins.length === 1 && allowedOrigins[0] === "*" 
      ? "*" 
      : allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(cors());
app.use(express.json());

// Serve static files (for local development)
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
  const lines = [];
  // Rows
  for (let r = 0; r < 5; r++) {
    lines.push([0,1,2,3,4].map(c => r * 5 + c));
  }
  // Cols
  for (let c = 0; c < 5; c++) {
    lines.push([0,1,2,3,4].map(r => r * 5 + c));
  }
  // Diags
  lines.push([0, 6, 12, 18, 24]);
  lines.push([4, 8, 12, 16, 20]);
  
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
      countdownEndTime: null
    };
    
    room.players.set(socket.id, {
      id: socket.id,
      name: name,
      marked: [],
      finished: false,
      finishTime: null
    });
    
    rooms.set(roomCode, room);
    socket.join(roomCode);
    
    // Send lobby state to creator
    socket.emit('roomCreated', {
      roomCode: roomCode,
      mode: mode,
      isHost: true,
      players: Array.from(room.players.values()).map(p => ({
        id: p.id,
        name: p.name
      }))
    });
    
    console.log(`Room ${roomCode} created by ${name} (lobby)`);
  });

  socket.on('joinRoom', ({ roomCode, name }) => {
    const room = rooms.get(roomCode);
    
    if (!room) {
      socket.emit('joinError', { message: 'Room not found' });
      return;
    }
    
    // Check if game has already started
    if (room.status === 'in-game') {
      socket.emit('joinError', { message: 'Game has already started' });
      return;
    }
    
    // Lock-out mode: only allow 2 players
    if (room.mode === 'lock-out' && room.players.size >= 2) {
      socket.emit('joinError', { message: 'Lock-out mode is limited to 2 players' });
      return;
    }
    
    // Check if player already in room
    if (room.players.has(socket.id)) {
      socket.emit('joinError', { message: 'Already in this room' });
      return;
    }
    
    room.players.set(socket.id, {
      id: socket.id,
      name: name,
      marked: [],
      finished: false,
      finishTime: null
    });
    
    socket.join(roomCode);
    
    // Send lobby state to joiner
    socket.emit('roomJoined', {
      roomCode: roomCode,
      mode: room.mode,
      isHost: false,
      players: Array.from(room.players.values()).map(p => ({
        id: p.id,
        name: p.name
      }))
    });
    
    // Notify all players in room about the new player
    io.to(roomCode).emit('playerJoined', {
      name: name,
      players: Array.from(room.players.values()).map(p => ({
        id: p.id,
        name: p.name
      }))
    });
    
    console.log(`${name} joined room ${roomCode} (lobby)`);
  });

  socket.on('startGame', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    
    if (!room) {
      socket.emit('startGameError', { message: 'Room not found' });
      return;
    }
    
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
    io.to(roomCode).emit('gameStarted', {
      roomCode: roomCode,
      board: room.board,
      mode: room.mode,
      startTime: room.startTime
    });
    
    console.log(`Game started in room ${roomCode} by host`);
  });

  socket.on('updateMarked', ({ roomCode, marked }) => {
    const room = rooms.get(roomCode);
    if (!room || !room.players.has(socket.id)) return;
    
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
    const room = rooms.get(roomCode);
    if (!room || !room.players.has(socket.id)) {
      socket.emit('lockTileError', { message: 'Room not found' });
      return;
    }
    
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
    if (room.lockedTiles.has(tileIndex)) {
      socket.emit('lockTileError', { message: 'Tile already locked' });
      return;
    }
    
    // Check if tile is FREE (center in easy mode)
    if (room.board[tileIndex] === 'FREE') {
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
    room.lockedTiles.set(tileIndex, lockData);
    
    // Add to lock history
    room.lockHistory.push({
      tileIndex: tileIndex,
      playerId: socket.id,
      playerName: player.name,
      timestamp: timestamp,
      challenge: room.board[tileIndex],
      elapsedMs: timestamp - room.startTime
    });
    
    // Update player's marked array for bingo checking
    if (!player.marked.includes(tileIndex)) {
      player.marked.push(tileIndex);
    }
    
    // Broadcast tile locked to all players
    io.to(roomCode).emit('tileLocked', {
      tileIndex: tileIndex,
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
        io.to(roomCode).emit('countdownModeStarted', {
          endTime: room.countdownEndTime
        });
      } else {
        // Refresh countdown (2 minutes from now)
        room.countdownEndTime = Date.now() + 120000;
        io.to(roomCode).emit('countdownRefreshed', {
          endTime: room.countdownEndTime
        });
      }
    }
    
    console.log(`${player.name} locked tile ${tileIndex} in room ${roomCode}`);
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
    if (markedSet.size < 5) return;
    
    // Check rows
    for (let r = 0; r < 5; r++) {
      let ok = true;
      for (let c = 0; c < 5; c++) {
        if (!markedSet.has(r * 5 + c)) { ok = false; break; }
      }
      if (ok) {
        handleLockOutBingo(room, player, socket);
        return;
      }
    }
    
    // Check cols
    for (let c = 0; c < 5; c++) {
      let ok = true;
      for (let r = 0; r < 5; r++) {
        if (!markedSet.has(r * 5 + c)) { ok = false; break; }
      }
      if (ok) {
        handleLockOutBingo(room, player, socket);
        return;
      }
    }
    
    // Check diags
    if ([0, 6, 12, 18, 24].every(i => markedSet.has(i))) {
      handleLockOutBingo(room, player, socket);
      return;
    }
    if ([4, 8, 12, 16, 20].every(i => markedSet.has(i))) {
      handleLockOutBingo(room, player, socket);
      return;
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
    const room = rooms.get(roomCode);
    if (!room || !room.players.has(socket.id)) {
      socket.emit('verifyResult', { valid: false, message: 'Room not found' });
      return;
    }
    
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
    
    // Check for bingo (same logic as frontend)
    const markedSet = new Set(marked);
    if (markedSet.size < 5) {
      socket.emit('verifyResult', { valid: false });
      return;
    }
    
    // Check rows
    for (let r = 0; r < 5; r++) {
      let ok = true;
      for (let c = 0; c < 5; c++) {
        if (!markedSet.has(r * 5 + c)) { ok = false; break; }
      }
      if (ok) {
        handleBingo(room, player, socket);
        return;
      }
    }
    
    // Check cols
    for (let c = 0; c < 5; c++) {
      let ok = true;
      for (let r = 0; r < 5; r++) {
        if (!markedSet.has(r * 5 + c)) { ok = false; break; }
      }
      if (ok) {
        handleBingo(room, player, socket);
        return;
      }
    }
    
    // Check diags
    if ([0, 6, 12, 18, 24].every(i => markedSet.has(i))) {
      handleBingo(room, player, socket);
      return;
    }
    if ([4, 8, 12, 16, 20].every(i => markedSet.has(i))) {
      handleBingo(room, player, socket);
      return;
    }
    
    socket.emit('verifyResult', { valid: false });
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
        socket.to(code).emit('playerLeft', {
          name: player.name,
          players: Array.from(room.players.values()).map(p => ({
            id: p.id,
            name: p.name
          }))
        });
        
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

