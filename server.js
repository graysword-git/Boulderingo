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

// Clean up empty rooms periodically
setInterval(() => {
  for (const [code, room] of rooms.entries()) {
    if (room.players.size === 0) {
      rooms.delete(code);
    }
  }
}, 60000); // Check every minute

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
      leaderboard: []
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
    
    const player = room.players.get(socket.id);
    player.marked = marked;
    
    // Broadcast to other players (optional - if you want to see others' progress)
    // socket.to(roomCode).emit('playerProgress', {
    //   playerId: socket.id,
    //   playerName: player.name,
    //   markedCount: marked.length
    // });
  });

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

