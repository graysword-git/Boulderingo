const nameInput = document.getElementById('nameInput');
const generateBtn = document.getElementById('generateBtn');
const resetBtn = document.getElementById('resetBtn');
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
	
	// Change this to your backend server URL
	// For local development: 'http://localhost:3000'
	// For production: replace with your actual backend server URL
	// You can set this via a data attribute in HTML or environment variable
	const backendUrl = document.body.dataset.backendUrl || '';
	
	// Determine server URL
	let serverUrl;
	if (backendUrl) {
		serverUrl = backendUrl;
	} else if (window.location.protocol === 'file:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
		// Local development - always use localhost:3000
		serverUrl = 'http://localhost:3000';
	} else {
		// Production - use same origin
		serverUrl = window.location.origin;
	}
	
	socket = io(serverUrl);
	
	socket.on('connect', () => {
		console.log('Connected to server');
	});
	
	socket.on('disconnect', () => {
		console.log('Disconnected from server');
	});
	
	socket.on('roomCreated', ({ roomCode, board, mode, startTime }) => {
		currentRoomCode = roomCode;
		roomStartTime = startTime;
		roomCodeDisplay.textContent = roomCode;
		roomInfo.style.display = 'block';
		roomPlayers.textContent = 'Players: 1';
		
		// Set mode and render board
		modeSelect.value = mode;
		renderBoard(board);
		saveData(nameInput.value.trim(), board);
		localStorage.removeItem('bingoMarked');
		exchangeUsed = false;
		localStorage.setItem('exchangeUsed', 'false');
		updateExchangeButtonState();
		
		// Start timer from room start time
		timerStartMs = startTime;
		updateTimer();
		if (!timerInterval) timerInterval = setInterval(updateTimer, 1000);
		
		// Show leaderboard
		leaderboard.style.display = 'block';
		leaderboardTitle.textContent = 'Room Leaderboard';
		leaderboardList.innerHTML = '<li>Waiting for players to finish...</li>';
	});
	
	socket.on('roomJoined', ({ roomCode, board, mode, startTime, players, leaderboard: roomLeaderboard }) => {
		currentRoomCode = roomCode;
		roomStartTime = startTime;
		roomCodeDisplay.textContent = roomCode;
		roomInfo.style.display = 'block';
		roomPlayers.textContent = `Players: ${players.length}`;
		
		// Set mode and render board
		modeSelect.value = mode;
		renderBoard(board);
		saveData(nameInput.value.trim(), board);
		localStorage.removeItem('bingoMarked');
		exchangeUsed = false;
		localStorage.setItem('exchangeUsed', 'false');
		updateExchangeButtonState();
		
		// Start timer from room start time
		timerStartMs = startTime;
		updateTimer();
		if (!timerInterval) timerInterval = setInterval(updateTimer, 1000);
		
		// Show leaderboard
		leaderboard.style.display = 'block';
		leaderboardTitle.textContent = 'Room Leaderboard';
		renderMultiplayerLeaderboard(roomLeaderboard);
	});
	
	socket.on('joinError', ({ message }) => {
		alert(`Error: ${message}`);
	});
	
	socket.on('playerJoined', ({ name, playerCount }) => {
		roomPlayers.textContent = `Players: ${playerCount}`;
		console.log(`${name} joined the room`);
	});
	
	socket.on('playerLeft', ({ name, playerCount }) => {
		roomPlayers.textContent = `Players: ${playerCount}`;
		console.log(`${name} left the room`);
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
		// free space handling: start marked but no special class
		if (text === 'FREE') cell.classList.add('marked');
		// track marked cells by pointer down
		if (marked.includes(index)) cell.classList.add('marked');
		cell.addEventListener('pointerdown', () => {
			if (exchangeMode) return;
			if (cell.textContent === 'FREE') return;
			cell.classList.toggle('marked');
			saveMarkedState();
		});
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

function hasBingo() {
	const marked = getMarkedSet();
	if (marked.size < 5) return false;
	// rows
	for (let r = 0; r < 5; r++) {
		let ok = true;
		for (let c = 0; c < 5; c++) {
			if (!marked.has(r * 5 + c)) { ok = false; break; }
		}
		if (ok) return true;
	}
	// cols
	for (let c = 0; c < 5; c++) {
		let ok = true;
		for (let r = 0; r < 5; r++) {
			if (!marked.has(r * 5 + c)) { ok = false; break; }
		}
		if (ok) return true;
	}
	// diag TL-BR
	if ([0, 6, 12, 18, 24].every(i => marked.has(i))) return true;
	// diag TR-BL
	if ([4, 8, 12, 16, 20].every(i => marked.has(i))) return true;
	return false;
}

function getWinningLines() {
	const lines = [];
	// rows
	for (let r = 0; r < 5; r++) lines.push([0,1,2,3,4].map(c => r * 5 + c));
	// cols
	for (let c = 0; c < 5; c++) lines.push([0,1,2,3,4].map(r => r * 5 + c));
	// diags
	lines.push([0, 6, 12, 18, 24]);
	lines.push([4, 8, 12, 16, 20]);

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

/* Leaderboard temporarily disabled
function formatMs(ms) {
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
	const seconds = String(totalSeconds % 60).padStart(2, '0');
	return `${minutes}:${seconds}`;
}

function saveLeaderboardEntry(timeMs) {
	const name = (nameInput && nameInput.value.trim()) || 'Anonymous';
	const mode = (modeSelect && modeSelect.value) || 'easy';
	const entry = { name, timeMs, mode, date: new Date().toISOString() };
	const list = JSON.parse(localStorage.getItem('leaderboard') || '[]');
	list.push(entry);
	list.sort((a,b) => a.timeMs - b.timeMs);
	const top10 = list.slice(0, 10);
	localStorage.setItem('leaderboard', JSON.stringify(top10));
	renderLeaderboard();
}

function renderLeaderboard() {
	const listEl = document.getElementById('leaderboardList');
	if (!listEl) return;
	const list = JSON.parse(localStorage.getItem('leaderboard') || '[]');
	listEl.innerHTML = '';
	list.forEach((e, idx) => {
		const li = document.createElement('li');
		li.textContent = `${idx+1}. ${e.name} — ${formatMs(e.timeMs)} (${e.mode})`;
		listEl.appendChild(li);
	});
}
*/

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
				// save leaderboard using precise ms if available
				// leaderboard disabled for now
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
		currentRoomCode = null;
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

window.addEventListener('load', loadData);
// window.addEventListener('load', renderLeaderboard); // leaderboard disabled for now
