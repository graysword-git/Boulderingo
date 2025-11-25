const nameInput = document.getElementById('nameInput');
const generateBtn = document.getElementById('generateBtn');
const bingoBoard = document.getElementById('bingoBoard');
const welcome = document.getElementById('welcome');
const exchangeBtn = document.getElementById('exchangeBtn');
const timerEl = document.getElementById('timer');
const verifyBtn = document.getElementById('verifyBtn');
const modeSelect = document.getElementById('modeSelect');
const containerEl = document.getElementById('container');

// Multiplayer elements
const singlePlayerBtn = document.getElementById('singlePlayerBtn');
const multiplayerBtn = document.getElementById('multiplayerBtn');
const singlePlayerControls = document.getElementById('singlePlayerControls');
const multiplayerControls = document.getElementById('multiplayerControls');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const roomCodeInput = document.getElementById('roomCodeInput');
const roomInfo = document.getElementById('roomInfo');
const roomCodeDisplay = document.getElementById('roomCodeDisplay');
const roomPlayers = document.getElementById('roomPlayers');
const leaderboard = document.getElementById('leaderboard');
const leaderboardTitle = document.getElementById('leaderboardTitle');
const leaderboardList = document.getElementById('leaderboardList');

// Socket.io connection (will be initialized when needed)
let socket = null;
let isMultiplayer = false;
let currentRoomCode = null;
let roomStartTime = null;
let isHost = false;
let lobbyPlayers = [];
let currentMode = 'easy';
let lockedTiles = new Map(); // tileIndex → {playerId, playerName}
let confirmingTileIndex = null;
let lockCounts = { myLocks: 0, opponentLocks: 0 };
let countdownEndTime = null;
let countdownInterval = null;

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
]

const HARD_CHALLENGES = [
	"E-limb-ination",
	"Orange -1 hold",
	"Graysword Kilter 40°",
	"Campus",
	"Feet b4 hands"
]

let timerInterval = null;
let timerStartMs = null;
let exchangeMode = false;
let exchangeUsed = false;

// Initialize Socket.io connection
function initSocket() {
	if (socket) return socket;
	
	// Backend URL can be set via data-backend-url attribute in HTML
	// For local development: leave empty to auto-detect localhost
	// For production: set to your backend URL (e.g., "https://boulderingo.onrender.com")
	const backendUrl = (document.body.dataset.backendUrl || '').trim();
	
	// Determine server URL
	let serverUrl;
	if (backendUrl) {
		// Use explicitly set backend URL
		serverUrl = backendUrl;
	} else if (window.location.protocol === 'file:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
		// Local development - always use localhost:3000
		serverUrl = 'http://localhost:3000';
	} else {
		// Production - if no backend URL set, try same origin (won't work if backend is on different domain)
		// You should set data-backend-url attribute with your backend URL
		console.warn('No backend URL configured. Set data-backend-url attribute in <body> tag with your backend URL.');
		serverUrl = window.location.origin;
	}
	
	socket = io(serverUrl);
	
	socket.on('connect', () => {
		console.log('Connected to server');
	});
	
	socket.on('disconnect', () => {
		console.log('Disconnected from server');
	});
	
	// Helper: Setup lobby UI (used by both roomCreated and roomJoined)
	function setupLobbyUI(roomCode, mode, isHost, players) {
		currentRoomCode = roomCode;
		isHost = isHost;
		lobbyPlayers = players;
		roomCodeDisplay.textContent = roomCode;
		roomInfo.style.display = 'block';
		modeSelect.value = mode;
		showLobby(players, isHost);
	}
	
	// Both roomCreated and roomJoined do the same thing - merge handlers
	socket.on('roomCreated', ({ roomCode, mode, isHost, players }) => {
		setupLobbyUI(roomCode, mode, isHost, players);
	});
	
	socket.on('roomJoined', ({ roomCode, mode, isHost, players }) => {
		setupLobbyUI(roomCode, mode, isHost, players);
	});
	
	socket.on('joinError', ({ message }) => {
		alert(`Error: ${message}`);
	});
	
	// Helper: Update lobby when player list changes
	function handlePlayerListUpdate(name, players, action) {
		lobbyPlayers = players;
		updateLobbyPlayers(players);
		console.log(`${name} ${action} the room`);
	}
	
	socket.on('playerJoined', ({ name, players }) => {
		handlePlayerListUpdate(name, players, 'joined');
	});
	
	socket.on('playerLeft', ({ name, players }) => {
		handlePlayerListUpdate(name, players, 'left');
	});
	
	socket.on('playerRejoined', ({ name, players }) => {
		handlePlayerListUpdate(name, players, 'rejoined');
	});
	
	// Helper: Setup game UI based on mode
	function setupGameUI(mode, board, startTime, marked = null, lockedTilesData = null, lockCountsData = null, countdownMode = false, countdownEndTimeParam = null, leaderboardData = null) {
		roomStartTime = startTime;
		currentMode = mode;
		
		// Hide lobby first
		hideLobby();
		
		// Set mode and render board
		modeSelect.value = mode;
		
		// Show common game elements
		bingoBoard.style.display = 'grid';
		timerEl.style.display = 'block';
		
		// Initialize lock-out mode
		if (mode === 'lock-out') {
			if (lockedTilesData) {
				lockedTiles = new Map(Object.entries(lockedTilesData).map(([key, value]) => [parseInt(key), value]));
			} else {
				lockedTiles = new Map();
			}
			if (lockCountsData) {
				const myId = socket.id;
				lockCounts.myLocks = lockCountsData[myId] || 0;
				const opponentId = Object.keys(lockCountsData).find(id => id !== myId);
				lockCounts.opponentLocks = opponentId ? (lockCountsData[opponentId] || 0) : 0;
			} else {
				lockCounts = { myLocks: 0, opponentLocks: 0 };
			}
			confirmingTileIndex = null;
			verifyBtn.style.display = 'none'; // Hide verify button
			exchangeBtn.style.display = 'none'; // Hide exchange button
			document.getElementById('lockOutStats').style.display = 'block';
			updateLockStats();
			
			// Restore countdown if active
			if (countdownMode && countdownEndTimeParam) {
				countdownEndTime = countdownEndTimeParam; // Assign parameter to global variable
				document.getElementById('countdownMode').style.display = 'block';
				startCountdown();
			} else {
				document.getElementById('countdownMode').style.display = 'none';
			}
			document.getElementById('lockConfirm').style.display = 'none';
			document.getElementById('recapLog').style.display = 'none';
			leaderboard.style.display = 'none';
		} else {
			// Regular multiplayer mode (easy/hard)
			verifyBtn.style.display = 'block';
			exchangeBtn.style.display = 'block';
			document.getElementById('lockOutStats').style.display = 'none';
			document.getElementById('countdownMode').style.display = 'none';
			document.getElementById('lockConfirm').style.display = 'none';
			document.getElementById('recapLog').style.display = 'none';
			leaderboard.style.display = 'block';
			leaderboardTitle.textContent = 'Room Leaderboard';
			if (leaderboardData && leaderboardData.length > 0) {
				renderMultiplayerLeaderboard(leaderboardData.map((entry, index) => ({
					position: index + 1,
					name: entry.name,
					elapsedMs: entry.elapsedMs
				})));
			} else {
				leaderboardList.innerHTML = '<li>Waiting for players to finish...</li>';
			}
		}
		
		// Render board with marked tiles if provided
		renderBoard(board, marked || []);
		saveData(nameInput.value.trim(), board);
		
		// Restore marked state if provided
		if (marked && marked.length > 0) {
			localStorage.setItem('bingoMarked', JSON.stringify(marked));
		} else {
			localStorage.removeItem('bingoMarked');
		}
		
		// Reset exchange if starting fresh
		if (!marked) {
			exchangeUsed = false;
			localStorage.setItem('exchangeUsed', 'false');
		}
		updateExchangeButtonState();
		
		// Start timer from room start time
		timerStartMs = startTime;
		updateTimer();
		if (!timerInterval) timerInterval = setInterval(updateTimer, 1000);
	}
	
	socket.on('gameStarted', ({ roomCode, board, mode, startTime }) => {
		setupGameUI(mode, board, startTime);
	});
	
	socket.on('gameRejoined', ({ roomCode, board, mode, startTime, marked, lockedTiles: serverLockedTiles, lockCounts: serverLockCounts, countdownMode, countdownEndTime, leaderboard: roomLeaderboard }) => {
		setupGameUI(mode, board, startTime, marked, serverLockedTiles, serverLockCounts, countdownMode, countdownEndTime, roomLeaderboard);
	});
	
	socket.on('startGameError', ({ message }) => {
		alert(`Error: ${message}`);
	});
	
	socket.on('hostChanged', ({ isHost: hostStatus }) => {
		isHost = hostStatus;
		updateStartGameButton();
	});
	
	socket.on('tileLocked', ({ tileIndex, playerId, playerName, timestamp, lockedTiles: serverLockedTiles, lockCounts: serverLockCounts }) => {
		// Update locked tiles map
		lockedTiles.set(tileIndex, { playerId, playerName, timestamp });
		
		// Update lock counts
		if (serverLockCounts) {
			const myId = socket.id;
			lockCounts.myLocks = serverLockCounts[myId] || 0;
			// Find opponent's count
			const opponentId = Object.keys(serverLockCounts).find(id => id !== myId);
			lockCounts.opponentLocks = opponentId ? (serverLockCounts[opponentId] || 0) : 0;
		}
		
		// Update board visuals
		updateLockedTileVisual(tileIndex, playerId === socket.id);
		
		// Update stats
		updateLockStats();
		
		// Cancel confirmation if this was the tile being confirmed
		if (confirmingTileIndex === tileIndex) {
			cancelTileConfirmation();
		}
	});
	
	socket.on('lockTileError', ({ message }) => {
		alert(`Error: ${message}`);
		cancelTileConfirmation();
	});
	
	socket.on('lockOutWin', ({ winnerId, winnerName, elapsedMs, lockHistory, winType }) => {
		stopTimer();
		stopCountdown();
		const finalTime = timerEl ? timerEl.textContent : '';
		highlightWinningLines(getWinningLines());
		
		let message = `🎉 ${winnerName} wins! 🎉\nTime: ${finalTime}`;
		if (winType === 'bingo') {
			message += '\nWin Type: Bingo!';
		}
		alert(message);
		
		// Show recap log
		showRecapLog(lockHistory);
	});
	
	socket.on('countdownModeStarted', ({ endTime }) => {
		countdownEndTime = endTime;
		document.getElementById('countdownMode').style.display = 'block';
		startCountdown();
	});
	
	socket.on('countdownRefreshed', ({ endTime }) => {
		countdownEndTime = endTime;
	});
	
	socket.on('countdownEnded', ({ winnerId, winnerName, lockCounts: finalLockCounts, lockHistory, winType }) => {
		stopTimer();
		stopCountdown();
		
		let message;
		if (winType === 'tie') {
			message = `🤝 Tie Game! 🤝\nBoth players locked ${finalLockCounts[Object.keys(finalLockCounts)[0]]} tiles`;
		} else {
			message = `🎉 ${winnerName} wins! 🎉\nWin Type: Most tiles locked`;
		}
		alert(message);
		
		// Show recap log
		showRecapLog(lockHistory);
	});
	
	socket.on('leaderboardUpdate', ({ leaderboard: roomLeaderboard }) => {
		renderMultiplayerLeaderboard(roomLeaderboard);
	});
	
	socket.on('verifyResult', ({ valid, elapsedMs, position, message }) => {
		if (valid) {
			stopTimer();
			const finalTime = timerEl ? timerEl.textContent : '';
			const lines = getWinningLines();
			highlightWinningLines(lines);
			alert(`🎉 You win! 🎉\nTime: ${finalTime}\nPosition: ${position}`);
		} else {
			if (message) {
				alert(message);
			} else {
				if (containerEl) {
					containerEl.classList.add('verify-fail');
					setTimeout(() => containerEl.classList.remove('verify-fail'), 500);
				}
			}
		}
	});
	
	return socket;
}

function formatMs(ms) {
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
	const seconds = String(totalSeconds % 60).padStart(2, '0');
	return `${minutes}:${seconds}`;
}

function renderMultiplayerLeaderboard(roomLeaderboard) {
	if (!leaderboardList) return;
	leaderboardList.innerHTML = '';
	
	if (roomLeaderboard.length === 0) {
		leaderboardList.innerHTML = '<li>Waiting for players to finish...</li>';
		return;
	}
	
	roomLeaderboard.forEach((entry) => {
		const li = document.createElement('li');
		li.textContent = `${entry.position}. ${entry.name} — ${formatMs(entry.elapsedMs)}`;
		leaderboardList.appendChild(li);
	});
}

// Lobby functions
function showLobby(players, hostStatus) {
	isHost = hostStatus;
	lobbyPlayers = players;
	
	// Hide ALL game elements
	bingoBoard.style.display = 'none';
	verifyBtn.style.display = 'none';
	exchangeBtn.style.display = 'none';
	leaderboard.style.display = 'none';
	timerEl.style.display = 'none';
	document.getElementById('lockOutStats').style.display = 'none';
	document.getElementById('countdownMode').style.display = 'none';
	document.getElementById('lockConfirm').style.display = 'none';
	document.getElementById('recapLog').style.display = 'none';
	
	// Show lobby
	const lobbyEl = document.getElementById('lobby');
	if (lobbyEl) {
		lobbyEl.style.display = 'block';
		updateLobbyPlayers(players);
		updateStartGameButton();
	}
}

function hideLobby() {
	const lobbyEl = document.getElementById('lobby');
	if (lobbyEl) {
		lobbyEl.style.display = 'none';
	}
	// Don't show game elements here - let gameStarted/gameRejoined handlers do it
	// This ensures proper mode-based visibility
}

function updateLobbyPlayers(players) {
	const lobbyPlayersEl = document.getElementById('lobbyPlayers');
	if (lobbyPlayersEl) {
		lobbyPlayersEl.innerHTML = '';
		players.forEach((player) => {
			const li = document.createElement('li');
			let playerText = player.name;
			if (socket && player.id === socket.id) {
				if (isHost) {
					playerText += ' (You - Host)';
				} else {
					playerText += ' (You)';
				}
			}
			li.textContent = playerText;
			lobbyPlayersEl.appendChild(li);
		});
	}
	
	// Update player count
	if (roomPlayers) {
		roomPlayers.textContent = `Players: ${players.length}`;
	}
}

function updateStartGameButton() {
	const startGameBtn = document.getElementById('startGameBtn');
	const waitingForHost = document.getElementById('waitingForHost');
	if (startGameBtn) {
		startGameBtn.style.display = isHost ? 'block' : 'none';
		startGameBtn.disabled = false;
		startGameBtn.textContent = 'Start Game';
	}
	if (waitingForHost) {
		waitingForHost.style.display = isHost ? 'none' : 'block';
	}
}

function stopTimer() {
	if (timerInterval) {
		clearInterval(timerInterval);
		timerInterval = null;
	}
	// persist stopped state and final elapsed
	if (timerStartMs != null) {
		const stoppedElapsed = Date.now() - timerStartMs;
		localStorage.setItem('timerElapsedMs', String(stoppedElapsed));
	}
	localStorage.setItem('timerRunning', 'false');
}

function updateTimer() {
	if (timerStartMs == null) return;
	const elapsed = Date.now() - timerStartMs;
	const totalSeconds = Math.floor(elapsed / 1000);
	const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
	const seconds = String(totalSeconds % 60).padStart(2, '0');
	if (timerEl) timerEl.textContent = `${minutes}:${seconds}`;
}

function startTimer() {
	stopTimer();
	timerStartMs = Date.now();
	if (timerEl) timerEl.textContent = '00:00';
	timerInterval = setInterval(updateTimer, 1000);
	// persist running state
	localStorage.setItem('timerStartMs', String(timerStartMs));
	localStorage.setItem('timerRunning', 'true');
	localStorage.removeItem('timerElapsedMs');
}

function getChallengePool() {
	const mode = (modeSelect && modeSelect.value) || 'easy';
	return mode === 'hard' ? [...CHALLENGES, ...HARD_CHALLENGES] : CHALLENGES;
}

function generateBoard() {
	// get items
	const poolSource = getChallengePool();
	const validItems = poolSource.filter(item => item.trim() !== "");
	// ensure min items
	const pool =
		validItems.length >= 25
		? validItems
		: [...validItems, ...Array(25 - validItems.length).fill("—")];
	// shuffle list
	const shuffled = [...pool].sort(() => 0.5 - Math.random());
	// select for board
	const board = shuffled.slice(0, 25);
	// force free space for easy mode (center index 12)
	const mode = (modeSelect && modeSelect.value) || 'easy';
	if (mode === 'easy') {
		board[12] = 'FREE';
	}
	return board;
}

function renderBoard(board, marked = []) {
	// empty board
	bingoBoard.innerHTML = '';
	// create cells
	board.forEach((text, index) => {
		const cell = document.createElement('div');
		cell.className = 'cell';
		cell.textContent = text || "";
		cell.dataset.tileIndex = index;
		
		// free space handling: start marked but no special class
		if (text === 'FREE') cell.classList.add('marked');
		
		// Lock-out mode: handle locked tiles
		if (currentMode === 'lock-out') {
			const lock = lockedTiles.get(index);
			if (lock) {
				if (lock.playerId === socket.id) {
					cell.classList.add('marked'); // Your locked tile
				} else {
					cell.classList.add('locked-by-opponent'); // Opponent's locked tile
				}
			}
			
			cell.addEventListener('pointerdown', () => {
				if (exchangeMode) return;
				if (cell.textContent === 'FREE') return;
				if (lockedTiles.has(index)) return; // Already locked
				if (confirmingTileIndex === index) return; // Already confirming
				
				// Start confirmation
				startTileConfirmation(index);
			});
		} else {
			// Regular mode
			if (marked.includes(index)) cell.classList.add('marked');
			cell.addEventListener('pointerdown', () => {
				if (exchangeMode) return;
				if (cell.textContent === 'FREE') return;
				cell.classList.toggle('marked');
				saveMarkedState();
			});
		}
		
		bingoBoard.appendChild(cell);
	});
}

function saveData(name, board) {
	// saving with local storage
	localStorage.setItem('bingoName', name);
	localStorage.setItem('bingoBoard', JSON.stringify(board));
}

function saveMarkedState() {
	const marked = [];
	// get marked cells
	document.querySelectorAll('.cell').forEach((cell, index) => {
		if (cell.classList.contains('marked')) marked.push(index);
	});
	localStorage.setItem('bingoMarked', JSON.stringify(marked));
	
	// If in multiplayer, sync with server
	if (isMultiplayer && socket && currentRoomCode) {
		socket.emit('updateMarked', { roomCode: currentRoomCode, marked });
	}
}

function loadData() {
	const name = localStorage.getItem('bingoName');
	const board = JSON.parse(localStorage.getItem('bingoBoard') || 'null');
	const marked = JSON.parse(localStorage.getItem('bingoMarked') || '[]');
	exchangeUsed = localStorage.getItem('exchangeUsed') === 'true';
	if (name) nameInput.value = name;
	if (name) welcome.textContent = `Welcome, ${name}!`;
	if (board) renderBoard(board, marked);
	updateExchangeButtonState();

	// restore timer state
	const timerRunning = localStorage.getItem('timerRunning') === 'true';
	const storedStart = localStorage.getItem('timerStartMs');
	const storedElapsed = localStorage.getItem('timerElapsedMs');
	if (board && timerRunning && storedStart) {
		// resume running timer
		timerStartMs = parseInt(storedStart, 10);
		updateTimer();
		if (!timerInterval) timerInterval = setInterval(updateTimer, 1000);
	} else if (board && !timerRunning && storedElapsed) {
		// show final elapsed without running
		const totalSeconds = Math.floor(parseInt(storedElapsed, 10) / 1000);
		const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
		const seconds = String(totalSeconds % 60).padStart(2, '0');
		if (timerEl) timerEl.textContent = `${minutes}:${seconds}`;
	}
}

function exchangeTile() {
	if (exchangeUsed) {
		return;
	}
	// toggle off if already in exchange mode
	if (exchangeMode) {
		exchangeMode = false;
		exchangeBtn.style.backgroundColor = '#9d4edd';
		bingoBoard.classList.remove('exchange-mode');
		return;
	}

	exchangeMode = true;
	exchangeBtn.style.backgroundColor = 'red';
	bingoBoard.classList.add('exchange-mode');

	// temporary event listener for board clicks
	const handleExchangeClick = (e) => {
		if (!exchangeMode) return;

		const cell = e.target;
		if (!cell.classList.contains('cell')) return;

		// get current board from storage
		const board = JSON.parse(localStorage.getItem('bingoBoard') || '[]');

		// determine index
		const index = Array.from(bingoBoard.children).indexOf(cell);

		// find unused items
		const usedItems = new Set(board);
		const poolSource = getChallengePool();
		const unusedItems = poolSource.filter(item => !usedItems.has(item));

		// prevent exchanging the FREE center in easy mode
		const mode = (modeSelect && modeSelect.value) || 'easy';
		if (mode === 'easy' && index === 12 && cell.textContent === 'FREE') {
			alert('Center FREE space cannot be exchanged in Easy mode.');
			exitExchangeMode();
			bingoBoard.removeEventListener('click', handleExchangeClick);
			return;
		}

		if (unusedItems.length === 0) {
			alert('No unused challenges left!');
			exitExchangeMode();
			return;
		}

		// update with random unused item
		const newItem = unusedItems[Math.floor(Math.random() * unusedItems.length)];
		board[index] = newItem;

		// save board
		cell.textContent = newItem;
		localStorage.setItem('bingoBoard', JSON.stringify(board));

		// mark exchange used and disable button
		exchangeUsed = true;
		localStorage.setItem('exchangeUsed', 'true');
		updateExchangeButtonState();

		// exit exchange mode
		exitExchangeMode();
		bingoBoard.removeEventListener('click', handleExchangeClick);
	};

	bingoBoard.addEventListener('click', handleExchangeClick);
}


function exitExchangeMode() {
	exchangeMode = false;
	exchangeBtn.style.backgroundColor = '#9d4edd';
	bingoBoard.classList.remove('exchange-mode');
}

function updateExchangeButtonState() {
	if (!exchangeBtn) return;
	exchangeBtn.disabled = !!exchangeUsed;
	exchangeBtn.style.opacity = exchangeUsed ? '0.5' : '';
	exchangeBtn.style.cursor = exchangeUsed ? 'not-allowed' : 'pointer';
}

function getMarkedSet() {
	const marked = new Set();
	document.querySelectorAll('.cell').forEach((cell, index) => {
		if (cell.classList.contains('marked')) marked.add(index);
	});
	return marked;
}

// Bingo line constants (matching server)
const BINGO_LINES = {
	DIAG_TL_BR: [0, 6, 12, 18, 24],
	DIAG_TR_BL: [4, 8, 12, 16, 20],
	checkBingo: function(markedSet) {
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
		if (this.DIAG_TL_BR.every(i => markedSet.has(i))) return true;
		if (this.DIAG_TR_BL.every(i => markedSet.has(i))) return true;
		
		return false;
	}
};

function hasBingo() {
	const marked = getMarkedSet();
	return BINGO_LINES.checkBingo(marked);
}

function getWinningLines() {
	const lines = [];
	// rows
	for (let r = 0; r < 5; r++) lines.push([0,1,2,3,4].map(c => r * 5 + c));
	// cols
	for (let c = 0; c < 5; c++) lines.push([0,1,2,3,4].map(r => r * 5 + c));
	// diags
	lines.push(BINGO_LINES.DIAG_TL_BR);
	lines.push(BINGO_LINES.DIAG_TR_BL);

	const marked = getMarkedSet();
	const winners = [];
	for (const line of lines) {
		if (line.every(i => marked.has(i))) winners.push(line);
	}
	return winners;
}

function highlightWinningLines(lines) {
	if (!lines || lines.length === 0) return;
	lines.forEach(line => {
		line.forEach(i => {
			const cell = bingoBoard.children[i];
			if (cell) cell.classList.add('win');
		});
	});
}


generateBtn.addEventListener('click', () => {
	// get name
	const name = nameInput.value.trim();
	if (!name) {
		alert('Please enter your name first!');
		return;
	}

	// check if a board already exists
	const existingBoard = localStorage.getItem('bingoBoard');
	if (existingBoard) {
		const confirmNew = confirm("Generating a new board will erase your current progress. Continue?");
		if (!confirmNew) return;
	}

	// proceed normally
	const board = generateBoard();
	renderBoard(board);
	saveData(name, board);
	localStorage.removeItem('bingoMarked');
	exchangeUsed = false;
	localStorage.setItem('exchangeUsed', 'false');
	updateExchangeButtonState();
	welcome.textContent = `Welcome, ${name}!`;
	startTimer();
});

if (verifyBtn) {
	verifyBtn.addEventListener('click', () => {
		const marked = [];
		document.querySelectorAll('.cell').forEach((cell, index) => {
			if (cell.classList.contains('marked')) marked.push(index);
		});
		
		if (isMultiplayer && socket && currentRoomCode) {
			// Multiplayer: verify on server
			socket.emit('verifyBingo', { roomCode: currentRoomCode, marked });
		} else {
			// Single player: verify locally
			if (hasBingo()) {
				stopTimer();
				const finalTime = timerEl ? timerEl.textContent : '';
				// highlight line
				const lines = getWinningLines();
				highlightWinningLines(lines);
				alert(`🎉 You win! 🎉\nTime: ${finalTime}`);
				return;
			}
			if (containerEl) {
				containerEl.classList.add('verify-fail');
				setTimeout(() => containerEl.classList.remove('verify-fail'), 500);
			}
		}
	});
}

// Game mode toggle
if (singlePlayerBtn && multiplayerBtn) {
	singlePlayerBtn.addEventListener('click', () => {
		isMultiplayer = false;
		singlePlayerBtn.classList.add('active');
		multiplayerBtn.classList.remove('active');
		singlePlayerControls.style.display = 'block';
		multiplayerControls.style.display = 'none';
		roomInfo.style.display = 'none';
		leaderboard.style.display = 'none';
		hideLobby();
		currentRoomCode = null;
		isHost = false;
		if (socket) {
			socket.disconnect();
			socket = null;
		}
	});
	
	multiplayerBtn.addEventListener('click', () => {
		isMultiplayer = true;
		multiplayerBtn.classList.add('active');
		singlePlayerBtn.classList.remove('active');
		singlePlayerControls.style.display = 'none';
		multiplayerControls.style.display = 'block';
		initSocket();
	});
}

// Create room
if (createRoomBtn) {
	createRoomBtn.addEventListener('click', () => {
		const name = nameInput.value.trim();
		if (!name) {
			alert('Please enter your name first!');
			return;
		}
		
		const mode = modeSelect.value;
		socket = initSocket();
		socket.emit('createRoom', { name, mode });
	});
}

// Join room
if (joinRoomBtn) {
	joinRoomBtn.addEventListener('click', () => {
		const name = nameInput.value.trim();
		if (!name) {
			alert('Please enter your name first!');
			return;
		}
		
		const roomCode = roomCodeInput.value.trim().toUpperCase();
		if (roomCode.length !== 4) {
			alert('Please enter a valid 4-character room code');
			return;
		}
		
		socket = initSocket();
		socket.emit('joinRoom', { roomCode, name });
	});
}

// Start game (host only)
const startGameBtn = document.getElementById('startGameBtn');
if (startGameBtn) {
	startGameBtn.addEventListener('click', () => {
		if (!socket || !currentRoomCode || !isHost) {
			alert('Only the host can start the game');
			return;
		}
		
		socket.emit('startGame', { roomCode: currentRoomCode });
		startGameBtn.disabled = true;
		startGameBtn.textContent = 'Starting...';
	});
}

// Lock-out mode helper functions
function startTileConfirmation(tileIndex) {
	confirmingTileIndex = tileIndex;
	const cell = bingoBoard.children[tileIndex];
	if (cell) {
		cell.classList.add('confirming');
	}
	document.getElementById('lockConfirm').style.display = 'block';
}

function cancelTileConfirmation() {
	if (confirmingTileIndex !== null) {
		const cell = bingoBoard.children[confirmingTileIndex];
		if (cell) {
			cell.classList.remove('confirming');
		}
		confirmingTileIndex = null;
	}
	document.getElementById('lockConfirm').style.display = 'none';
}

function confirmTileLock() {
	if (confirmingTileIndex === null || !socket || !currentRoomCode) return;
	
	socket.emit('lockTile', { roomCode: currentRoomCode, tileIndex: confirmingTileIndex });
	cancelTileConfirmation();
}

function updateLockedTileVisual(tileIndex, isMyTile) {
	const cell = bingoBoard.children[tileIndex];
	if (!cell) return;
	
	cell.classList.remove('confirming');
	if (isMyTile) {
		cell.classList.add('marked');
		cell.classList.remove('locked-by-opponent');
	} else {
		cell.classList.add('locked-by-opponent');
		cell.classList.remove('marked');
	}
}

function updateLockStats() {
	const statsText = document.getElementById('lockStatsText');
	if (statsText) {
		statsText.textContent = `You: ${lockCounts.myLocks} locked | Opponent: ${lockCounts.opponentLocks} locked`;
	}
}

function startCountdown() {
	if (countdownInterval) clearInterval(countdownInterval);
	
	countdownInterval = setInterval(() => {
		if (!countdownEndTime) return;
		
		const now = Date.now();
		const remaining = Math.max(0, countdownEndTime - now);
		
		if (remaining === 0) {
			stopCountdown();
			return;
		}
		
		const minutes = Math.floor(remaining / 60000);
		const seconds = Math.floor((remaining % 60000) / 1000);
		const timerText = document.getElementById('countdownTimer');
		if (timerText) {
			timerText.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
		}
	}, 100);
}

function stopCountdown() {
	if (countdownInterval) {
		clearInterval(countdownInterval);
		countdownInterval = null;
	}
	document.getElementById('countdownMode').style.display = 'none';
}

function showRecapLog(lockHistory) {
	const recapLog = document.getElementById('recapLog');
	const recapList = document.getElementById('recapList');
	
	if (!recapLog || !recapList) return;
	
	recapList.innerHTML = '';
	
	if (!lockHistory || lockHistory.length === 0) {
		recapList.innerHTML = '<li>No locks recorded</li>';
		recapLog.style.display = 'block';
		return;
	}
	
	lockHistory.forEach((lock, index) => {
		const li = document.createElement('li');
		const elapsedSeconds = Math.floor(lock.elapsedMs / 1000);
		const minutes = Math.floor(elapsedSeconds / 60);
		const seconds = elapsedSeconds % 60;
		const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
		li.textContent = `${timeStr} - ${lock.playerName} locked "${lock.challenge}"`;
		recapList.appendChild(li);
	});
	
	recapLog.style.display = 'block';
}

// Set up confirmation button handlers
const confirmLockBtn = document.getElementById('confirmLockBtn');
const cancelLockBtn = document.getElementById('cancelLockBtn');
if (confirmLockBtn) {
	confirmLockBtn.addEventListener('click', confirmTileLock);
}
if (cancelLockBtn) {
	cancelLockBtn.addEventListener('click', cancelTileConfirmation);
}

window.addEventListener('load', loadData);
