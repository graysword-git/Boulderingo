const nameInput = document.getElementById('nameInput');
const generateBtn = document.getElementById('generateBtn');
const bingoBoard = document.getElementById('bingoBoard');
const welcome = document.getElementById('welcome');
const exchangeBtn = document.getElementById('exchangeBtn');
const timerEl = document.getElementById('timer');
const verifyBtn = document.getElementById('verifyBtn');
const modeSelect = document.getElementById('modeSelect');
const minGradeSelect = document.getElementById('minGradeSelect');
const lockoutRadio = document.getElementById('lockoutRadio');
const normalRadio = document.getElementById('normalRadio');
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
	"Pink tag -7 holds",
	"Yellow tag -5 holds",
	"Green tag -3 holds",
	"Bathang any hold",
	"Slab 🥰",
	"Dyno 🤮",
	"Scorpion every move",
	"Graysword Kilter 30°",
	// "Sloper deadhang 5s" - Removed, generated dynamically based on mode
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
	// "ALL Pinks b2b" - Removed, generated dynamically based on mode
	"1 Hand only",
	"No hands on a volume"
]

const HARD_CHALLENGES = [
	"E-limb-ination",
	"Orange tag -1 hold",
	"Graysword Kilter 40°",
	"Campus",
	"Feet b4 hands"
]

let timerInterval = null;
let timerStartMs = null;
let exchangeMode = false;
let exchangeUsed = false;
let currentMinGrade = 'green'; // Track current min grade

// Challenge explanations dictionary
const CHALLENGE_EXPLANATIONS = {
	"Pink tag -7 holds": "Climb a pink tag route subtracting 7 holds",
	"Yellow tag -5 holds": "Climb a yellow tag route subtracting 5 holds",
	"Green tag -3 holds": "Climb a green tag route subtracting 3 holds",
	"Orange tag -1 hold": "Climb an orange tag route subtracting 1 hold",
	"Bathang any hold": "Hang from any hold with your body inverted (bathang position)",
	"Slab 🥰": "Climb a slab route (less than vertical, technical balance climbing)",
	"Dyno 🤮": "Perform a dynamic move (jump to a hold)",
	"Scorpion every move": "Use a scorpion position (one leg behind you) on every move",
	"Graysword Kilter 30°": "Hop on over to the Kilter board and search my username 'graysword', any climb counts (30° angle)",
	"Graysword Kilter 40°": "Hop on over to the Kilter board and search my username 'graysword', any climb counts (40° angle)",
	"Sloper deadhang 5s": "Deadhang from a sloper hold for 5 seconds",
	"Sloper deadhang 10s": "Deadhang from a sloper hold for 10 seconds",
	"Climb, downclimb, climb": "Climb up, then downclimb, then climb up again",
	"Stacked feet": "Use stacked feet (one foot on top of the other) during the climb",
	"Facing out start": "Start the climb facing away from the wall",
	"Campus anything": "Climb without using your feet (hands only)",
	"Campus": "Climb without using your feet (hands only)",
	"4 repeats 4 min": "Complete 4 ascents of the same route within 4 minutes",
	"Dropknee": "Use a dropknee technique during the climb",
	"Heel Hook": "Use a heel hook during the climb",
	"Toe Hook": "Use a toe hook during the climb",
	"Kneebar": "Use a kneebar during the climb",
	"Figure 4": "Use a figure-4 technique during the climb",
	"Flash x3": "Flash (complete on first try) 3 different routes - can be a day flash if you have climbed recently and are low on options",
	"Eyes closed": "Climb with your eyes closed (honour system, open if you feel unstable)",
	"Half & Half": "Left limbs on one route, right limbs on another route",
	"5 Pinks b2b": "Climb 5 pink-tagged routes back-to-back without rest",
	"10 Pinks b2b": "Climb 10 pink-tagged routes back-to-back without rest",
	"1 Hand only": "Climb using only one hand (other hand cannot touch holds)",
	"No hands on a volume": "Standing on one(1) volume, with no hands helping you",
	"E-limb-ination": "Repeat the route x3 with -1 limb each time",
	"Feet b4 hands": "Place your feet on each hold before your hands",
	"FREE": "Free space - automatically marked"
};

// Helper function to get explanation for a challenge
function getChallengeExplanation(challengeText) {
	if (!challengeText) return null;
	
	// Try exact match first
	if (CHALLENGE_EXPLANATIONS[challengeText]) {
		return CHALLENGE_EXPLANATIONS[challengeText];
	}
	
	// Try partial matches for variations (e.g., "Pink tag" matches "Pink tag -7 holds")
	for (const [key, value] of Object.entries(CHALLENGE_EXPLANATIONS)) {
		if (challengeText.includes(key) || key.includes(challengeText)) {
			return value;
		}
	}
	
	return null; // Return null if no explanation found (don't show tooltip)
}

// Grade order mapping
const GRADE_ORDER = {
  pink: { name: 'Pink', order: 1 },
  yellow: { name: 'Yellow', order: 2 },
  green: { name: 'Green', order: 3 },
  orange: { name: 'Orange', order: 4 },
  blue: { name: 'Blue', order: 5 }
};

// Get current game mode (handles lock-out radio button)
// Lock-out can now work with easy or hard mode
function getCurrentMode() {
  // Always return the actual mode (easy/hard), even if lock-out is selected
  return modeSelect ? modeSelect.value : 'easy'; // 'easy' or 'hard'
}

// Check if lock-out mode is selected
function isLockOutMode() {
  return lockoutRadio && lockoutRadio.checked;
}

// Centralized function to update game action buttons (Verify/Exchange) visibility
// This ensures buttons are only visible when:
// - A game is in progress (board is displayed)
// - NOT in lockout mode
function updateGameActionButtons() {
  // Check if board is visible - check both inline style and if board has content
  // Board is visible if: display is 'grid' OR board has children (cells) and is not explicitly hidden
  const boardHasContent = bingoBoard && bingoBoard.children.length > 0;
  const boardDisplayStyle = bingoBoard ? bingoBoard.style.display : '';
  const boardIsHidden = boardDisplayStyle === 'none';
  const boardVisible = boardHasContent && !boardIsHidden;
  
  // Check if in lockout mode (single player or multiplayer)
  const isLockout = isLockOutMode() || 
                    (isMultiplayer && currentMode && 
                     (currentMode === 'lock-out' || (typeof currentMode === 'string' && currentMode.startsWith('lock-out-'))));
  
  // Buttons should only be visible when board is visible AND not in lockout mode
  const shouldShow = boardVisible && !isLockout;
  
  // Update verify button
  if (verifyBtn) {
    toggleVisibility(verifyBtn, shouldShow);
    if (shouldShow) {
      verifyBtn.style.display = 'inline-block';
    }
  }
  
  // Update exchange button
  if (exchangeBtn) {
    toggleVisibility(exchangeBtn, shouldShow);
    if (shouldShow) {
      exchangeBtn.style.display = 'inline-block';
    }
  }
}

// Get current min grade
function getCurrentMinGrade() {
  return minGradeSelect ? minGradeSelect.value : 'green';
}

// Update UI when lock-out mode changes
// Note: Lock-out mode no longer disables other options - you can use any mode/grade with lock-out
function updateModeUI() {
  // No longer disabling controls - lock-out works with any settings
  // This function is kept for potential future UI updates but doesn't disable anything
}

// Initialize mode UI handlers
if (lockoutRadio && normalRadio) {
  lockoutRadio.addEventListener('change', updateModeUI);
  normalRadio.addEventListener('change', updateModeUI);
  // Set initial state
  updateModeUI();
}

// Hide lockout toggle on initial load (single player is default)
const lockoutToggle = document.getElementById('lockoutToggle');
if (lockoutToggle) {
  toggleVisibility(lockoutToggle, false);
}

// Initialize Socket.io connection (lazy - only when needed for multiplayer)
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
	function setupLobbyUI(roomCode, mode, isHost, players, minGrade = null) {
		currentRoomCode = roomCode;
		isHost = isHost;
		lobbyPlayers = players;
		roomCodeDisplay.textContent = roomCode;
		toggleVisibility(roomInfo, true);
		
		// Update UI to match room settings
		// Check if mode is lock-out (could be 'lock-out', 'lock-out-easy', or 'lock-out-hard')
		const isLockout = mode === 'lock-out' || (typeof mode === 'string' && mode.startsWith('lock-out-'));
		if (isLockout) {
			if (lockoutRadio) lockoutRadio.checked = true;
			if (normalRadio) normalRadio.checked = false;
			// Extract base mode from lock-out mode
			if (mode === 'lock-out-easy' || mode === 'lock-out') {
				if (modeSelect) modeSelect.value = 'easy';
			} else if (mode === 'lock-out-hard') {
				if (modeSelect) modeSelect.value = 'hard';
			}
		} else {
			if (normalRadio) normalRadio.checked = true;
			if (lockoutRadio) lockoutRadio.checked = false;
			if (modeSelect) modeSelect.value = mode;
		}
		
		if (minGrade && minGradeSelect) {
			minGradeSelect.value = minGrade;
			currentMinGrade = minGrade;
		}
		
		updateModeUI(); // Disable/enable controls based on mode
		showLobby(players, isHost);
	}
	
	// Both roomCreated and roomJoined do the same thing - merge handlers
	socket.on('roomCreated', ({ roomCode, mode, isHost, players, minGrade }) => {
		setupLobbyUI(roomCode, mode, isHost, players, minGrade);
	});
	
	socket.on('roomJoined', ({ roomCode, mode, isHost, players, minGrade }) => {
		setupLobbyUI(roomCode, mode, isHost, players, minGrade);
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
	function setupGameUI(mode, board, startTime, marked = null, lockedTilesData = null, lockCountsData = null, countdownMode = false, countdownEndTimeParam = null, leaderboardData = null, minGrade = null) {
		roomStartTime = startTime;
		currentMode = mode;
		
		// Update min grade
		if (minGrade) {
			currentMinGrade = minGrade;
		}
		
		// Update welcome message with min grade requirement
		const gradeName = GRADE_ORDER[currentMinGrade]?.name || 'Green';
		if (welcome && nameInput.value.trim()) {
			welcome.textContent = `Welcome, ${nameInput.value.trim()}! (Min: ${gradeName} or above)`;
		}
		
		// Hide lobby first
		hideLobby();
		
		// Set mode and render board
		// Check if mode is lock-out (could be 'lock-out', 'lock-out-easy', or 'lock-out-hard')
		const isLockoutMode = mode === 'lock-out' || (typeof mode === 'string' && mode.startsWith('lock-out-'));
		if (isLockoutMode) {
			if (lockoutRadio) lockoutRadio.checked = true;
			if (normalRadio) normalRadio.checked = false;
			// Extract base mode from lock-out mode
			if (mode === 'lock-out-easy' || mode === 'lock-out') {
				if (modeSelect) modeSelect.value = 'easy';
			} else if (mode === 'lock-out-hard') {
				if (modeSelect) modeSelect.value = 'hard';
			}
		} else {
			if (normalRadio) normalRadio.checked = true;
			if (lockoutRadio) lockoutRadio.checked = false;
			if (modeSelect) modeSelect.value = mode;
		}
		
		if (minGrade && minGradeSelect) {
			minGradeSelect.value = minGrade;
		}
		
		updateModeUI(); // Disable/enable controls
		
		// Show common game elements
		if (bingoBoard) {
			bingoBoard.style.display = 'grid';
			bingoBoard.classList.remove('hidden');
		}
		if (timerEl) {
			toggleVisibility(timerEl, true);
			timerEl.style.display = 'block'; // Timer needs block display
		}
		
		// Initialize lock-out mode (check if mode is lock-out variant)
		if (isLockoutMode) {
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
			updateGameActionButtons(); // Hide verify/exchange buttons in lockout mode
			toggleVisibility(document.getElementById('lockOutStats'), true);
			updateLockStats();
			
			// Restore countdown if active
			if (countdownMode && countdownEndTimeParam) {
				countdownEndTime = countdownEndTimeParam; // Assign parameter to global variable
				toggleVisibility(document.getElementById('countdownMode'), true);
				startCountdown();
			} else {
				toggleVisibility(document.getElementById('countdownMode'), false);
			}
			toggleVisibility(document.getElementById('lockConfirm'), false);
			toggleVisibility(document.getElementById('recapLog'), false);
			toggleVisibility(leaderboard, false);
		} else {
			// Regular multiplayer mode (easy/hard)
			updateGameActionButtons(); // Show verify/exchange buttons in normal mode
			toggleVisibility(document.getElementById('lockOutStats'), false);
			toggleVisibility(document.getElementById('countdownMode'), false);
			toggleVisibility(document.getElementById('lockConfirm'), false);
			toggleVisibility(document.getElementById('recapLog'), false);
			toggleVisibility(leaderboard, true);
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
		
		// Only save to localStorage for single player games (multiplayer board comes from server)
		if (!isMultiplayer) {
			saveData(nameInput.value.trim(), board);
			// Restore marked state if provided
			StorageManager.saveGameState({ marked: marked || [] });
			// Reset exchange if starting fresh
			if (!marked) {
				exchangeUsed = false;
				StorageManager.saveGameState({ exchangeUsed: false });
			}
		}
		updateExchangeButtonState();
		updateGameActionButtons(); // Update button visibility after game setup
		
		// Start timer from room start time
		timerStartMs = startTime;
		updateTimer();
		if (!timerInterval) timerInterval = setInterval(updateTimer, 1000);
	}
	
	socket.on('gameStarted', ({ roomCode, board, mode, startTime, minGrade }) => {
		// Ensure multiplayer mode is set (important for rejoin scenarios)
		isMultiplayer = true;
		setupGameUI(mode, board, startTime, null, null, null, false, null, null, minGrade);
	});
	
	socket.on('gameRejoined', ({ roomCode, board, mode, startTime, marked, lockedTiles: serverLockedTiles, lockCounts: serverLockCounts, countdownMode, countdownEndTime, leaderboard: roomLeaderboard, minGrade }) => {
		// Ensure multiplayer mode is set (important for rejoin scenarios)
		isMultiplayer = true;
		setupGameUI(mode, board, startTime, marked, serverLockedTiles, serverLockCounts, countdownMode, countdownEndTime, roomLeaderboard, minGrade);
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

// Helper function to ensure socket is ready (only called for multiplayer)
// Returns a promise that resolves to true if connected, false if connection failed
async function ensureSocketReady() {
	if (!socket) {
		socket = initSocket();
	}
	
	// If already connected, return immediately
	if (socket.connected) {
		return true;
	}
	
	// Wait for connection with timeout
	return new Promise((resolve) => {
		const timeout = setTimeout(() => {
			resolve(false);
		}, 5000); // 5 second timeout
		
		socket.once('connect', () => {
			clearTimeout(timeout);
			resolve(true);
		});
		
		socket.once('connect_error', () => {
			clearTimeout(timeout);
			resolve(false);
		});
	});
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
	toggleVisibility(bingoBoard, false);
	updateGameActionButtons(); // Hide buttons when in lobby
	toggleVisibility(leaderboard, false);
	toggleVisibility(timerEl, false);
	toggleVisibility(document.getElementById('lockOutStats'), false);
	toggleVisibility(document.getElementById('countdownMode'), false);
	toggleVisibility(document.getElementById('lockConfirm'), false);
	toggleVisibility(document.getElementById('recapLog'), false);
	
	// Show lobby
	const lobbyEl = document.getElementById('lobby');
	if (lobbyEl) {
		toggleVisibility(lobbyEl, true);
		updateLobbyPlayers(players);
		updateStartGameButton();
	}
}

function hideLobby() {
	toggleVisibility(document.getElementById('lobby'), false);
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
		toggleVisibility(startGameBtn, isHost);
		if (isHost) startGameBtn.style.display = 'block';
		startGameBtn.disabled = false;
		startGameBtn.textContent = 'Start Game';
	}
	if (waitingForHost) {
		toggleVisibility(waitingForHost, !isHost);
		if (!isHost) waitingForHost.style.display = 'block';
	}
}

function stopTimer() {
	if (timerInterval) {
		clearInterval(timerInterval);
		timerInterval = null;
	}
	// Only persist timer state for single player games (multiplayer timer is server-managed)
	if (!isMultiplayer) {
		if (timerStartMs != null) {
			const stoppedElapsed = Date.now() - timerStartMs;
			StorageManager.saveTimerState({ running: false, elapsedMs: stoppedElapsed });
		} else {
			StorageManager.saveTimerState({ running: false });
		}
	}
	// For multiplayer, timer state is managed by server - don't save to localStorage
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
	// Only persist timer state for single player games (multiplayer timer is server-managed)
	if (!isMultiplayer) {
		StorageManager.saveTimerState({ running: true, startMs: timerStartMs, elapsedMs: null });
	}
}

function getChallengePool(mode = null, minGrade = null) {
	const currentMode = mode || (modeSelect && modeSelect.value) || 'easy';
	const currentMinGrade = minGrade || getCurrentMinGrade();
	
	let pool = currentMode === 'hard' ? [...CHALLENGES, ...HARD_CHALLENGES] : [...CHALLENGES];
	
	// Add dynamic "Pinks b2b" challenge based on mode
	// Only add if minGrade is not pink (can't do pinks if pink is minimum)
	if (currentMinGrade !== 'pink') {
		const pinksChallenge = currentMode === 'hard' ? "10 Pinks b2b" : "5 Pinks b2b";
		pool.push(pinksChallenge);
	}
	
	// Add dynamic "Sloper deadhang" challenge based on mode
	const sloperChallenge = currentMode === 'hard' ? "Sloper deadhang 10s" : "Sloper deadhang 5s";
	pool.push(sloperChallenge);
	
	return pool;
}

function generateBoard() {
	// get items
	const mode = (modeSelect && modeSelect.value) || 'easy';
	const minGrade = getCurrentMinGrade();
	const poolSource = getChallengePool(mode, minGrade);
	const validItems = poolSource.filter(item => item.trim() !== "" && item !== "—");
	// ensure min items - if we don't have enough, just use what we have (shouldn't happen with dynamic challenges)
	const pool = validItems.length >= 25 ? validItems : validItems;
	// shuffle list
	const shuffled = [...pool].sort(() => 0.5 - Math.random());
	// select for board (take up to 25, or all if less)
	const board = shuffled.slice(0, Math.min(25, shuffled.length));
	// force free space for easy mode (center index 12)
	if (mode === 'easy') {
		board[12] = 'FREE';
	}
	return board;
}

// Tooltip management
let tooltipTimer = null;
let currentTooltipCell = null;
let pressTimer = null;
const LONG_PRESS_DURATION = 500; // 500ms for long press

// Setup tooltip for a cell
function setupChallengeTooltip(cell, challengeText) {
	const tooltip = document.getElementById('challengeTooltip');
	const tooltipTitle = document.getElementById('tooltipTitle');
	const tooltipText = document.getElementById('tooltipText');
	
	if (!tooltip || !tooltipTitle || !tooltipText) return;
	
	// Store tooltip state on the cell element itself
	let cellPressTimer = null;
	let cellPressStartTime = 0;
	let cellTooltipShown = false;
	
	function showTooltip(e) {
		const explanation = getChallengeExplanation(challengeText);
		if (!explanation) {
			return; // Don't show tooltip if no explanation
		}
		
		tooltipTitle.textContent = challengeText;
		tooltipText.textContent = explanation;
		toggleVisibility(tooltip, true);
		tooltip.style.display = 'block'; // Tooltip needs specific positioning
		
		// Position tooltip near the cell
		const rect = cell.getBoundingClientRect();
		const tooltipRect = tooltip.getBoundingClientRect();
		const scrollY = window.scrollY || window.pageYOffset;
		const scrollX = window.scrollX || window.pageXOffset;
		
		// Try to position above, fallback to below
		let top = rect.top + scrollY - tooltipRect.height - 10;
		let left = rect.left + scrollX + (rect.width / 2) - (tooltipRect.width / 2);
		
		// Adjust if tooltip goes off screen
		if (top < scrollY + 10) {
			top = rect.bottom + scrollY + 10; // Show below instead
		}
		if (left < scrollX + 10) {
			left = scrollX + 10;
		}
		if (left + tooltipRect.width > scrollX + window.innerWidth - 10) {
			left = scrollX + window.innerWidth - tooltipRect.width - 10;
		}
		
		tooltip.style.top = `${top}px`;
		tooltip.style.left = `${left}px`;
		
		currentTooltipCell = cell;
		cellTooltipShown = true;
		// Mark cell to prevent click action
		cell.dataset.tooltipActive = 'true';
	}
	
	function hideTooltip() {
		if (tooltip) {
			toggleVisibility(tooltip, false);
		}
		if (currentTooltipCell === cell) {
			currentTooltipCell = null;
		}
		cellTooltipShown = false;
		cell.dataset.tooltipActive = 'false';
	}
	
	function cancelPressTimer() {
		if (cellPressTimer) {
			clearTimeout(cellPressTimer);
			cellPressTimer = null;
		}
	}
	
	// Pointer events (works for both touch and mouse, better cross-browser support)
	cell.addEventListener('pointerdown', (e) => {
		// Only handle left mouse button or touch for long press
		if (e.button === 0 || e.pointerType === 'touch') {
			cellPressStartTime = Date.now();
			cellTooltipShown = false;
			cell.dataset.tooltipActive = 'false';
			cancelPressTimer();
			cellPressTimer = setTimeout(() => {
				showTooltip(e);
				cellPressTimer = null;
			}, LONG_PRESS_DURATION);
		}
	}, { passive: true });
	
	cell.addEventListener('pointerup', (e) => {
		const pressDuration = Date.now() - cellPressStartTime;
		cancelPressTimer();
		
		// If tooltip was shown or press was long enough, prevent click
		if (cellTooltipShown || pressDuration >= LONG_PRESS_DURATION) {
			// Small delay to ensure click event is prevented
			setTimeout(() => {
				cell.dataset.tooltipActive = 'false';
			}, 100);
		}
	}, { passive: true });
	
	cell.addEventListener('pointercancel', () => {
		cancelPressTimer();
		hideTooltip();
	});
	
	cell.addEventListener('pointerleave', () => {
		cancelPressTimer();
		// Only hide if it was a quick interaction (not a long press)
		if (Date.now() - cellPressStartTime < LONG_PRESS_DURATION) {
			hideTooltip();
		}
	});
	
	// Mouse events (desktop - right click)
	cell.addEventListener('contextmenu', (e) => {
		e.preventDefault();
		showTooltip(e);
	});
	
	// Touch events (mobile) - additional support for older browsers
	cell.addEventListener('touchstart', (e) => {
		cellPressStartTime = Date.now();
		cellTooltipShown = false;
		cell.dataset.tooltipActive = 'false';
		cancelPressTimer();
		cellPressTimer = setTimeout(() => {
			showTooltip(e);
			cellPressTimer = null;
		}, LONG_PRESS_DURATION);
	}, { passive: true });
	
	cell.addEventListener('touchend', (e) => {
		const pressDuration = Date.now() - cellPressStartTime;
		cancelPressTimer();
		// If tooltip was shown, prevent the click
		if (cellTooltipShown || pressDuration >= LONG_PRESS_DURATION) {
			e.preventDefault();
			setTimeout(() => {
				cell.dataset.tooltipActive = 'false';
			}, 100);
		}
	}, { passive: false });
	
	cell.addEventListener('touchcancel', () => {
		cancelPressTimer();
		hideTooltip();
	});
	
	cell.addEventListener('touchmove', () => {
		// Cancel long press if user moves finger
		cancelPressTimer();
		hideTooltip();
	}, { passive: true });
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
		cell.dataset.challengeText = text; // Store challenge text for tooltip
		
		// free space handling: start marked but no special class
		if (text === 'FREE') cell.classList.add('marked');
		
		// Add long press / right-click tooltip support
		setupChallengeTooltip(cell, text);
		
		// Lock-out mode: handle locked tiles (check if mode is lock-out variant)
		const isLockoutMode = currentMode === 'lock-out' || (typeof currentMode === 'string' && currentMode.startsWith('lock-out-'));
		if (isLockoutMode) {
			const lock = lockedTiles.get(index);
			if (lock) {
				if (lock.playerId === socket.id) {
					cell.classList.add('marked'); // Your locked tile
				} else {
					cell.classList.add('locked-by-opponent'); // Opponent's locked tile
				}
			}
			
			// Use click event instead of pointerdown to allow long press to work
			// Also track press time to detect long press
			let pressStartTime = 0;
			cell.addEventListener('pointerdown', () => {
				pressStartTime = Date.now();
			});
			
			cell.addEventListener('click', (e) => {
				// Don't mark if tooltip was shown (long press) or if press was too long
				const pressDuration = Date.now() - pressStartTime;
				if (cell.dataset.tooltipActive === 'true' || pressDuration >= LONG_PRESS_DURATION) {
					e.preventDefault();
					e.stopPropagation();
					cell.dataset.tooltipActive = 'false'; // Reset
					return;
				}
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
			// Use click event instead of pointerdown to allow long press to work
			// Also track press time to detect long press
			let pressStartTime = 0;
			cell.addEventListener('pointerdown', () => {
				pressStartTime = Date.now();
			});
			
			cell.addEventListener('click', (e) => {
				// Don't mark if tooltip was shown (long press) or if press was too long
				const pressDuration = Date.now() - pressStartTime;
				if (cell.dataset.tooltipActive === 'true' || pressDuration >= LONG_PRESS_DURATION) {
					e.preventDefault();
					e.stopPropagation();
					cell.dataset.tooltipActive = 'false'; // Reset
					return;
				}
				if (exchangeMode) return;
				if (cell.textContent === 'FREE') return;
				cell.classList.toggle('marked');
				saveMarkedState();
			});
		}
		
		bingoBoard.appendChild(cell);
	});
}

// StorageManager - Consolidates all localStorage operations
const StorageManager = {
	// Save game state (name, board, marked cells, exchange status)
	saveGameState({ name, board, marked, exchangeUsed }) {
		if (name !== undefined) localStorage.setItem('bingoName', name);
		if (board !== undefined) localStorage.setItem('bingoBoard', JSON.stringify(board));
		if (marked !== undefined) {
			if (marked && marked.length > 0) {
				localStorage.setItem('bingoMarked', JSON.stringify(marked));
			} else {
				localStorage.removeItem('bingoMarked');
			}
		}
		if (exchangeUsed !== undefined) {
			localStorage.setItem('exchangeUsed', String(exchangeUsed));
		}
	},
	
	// Load game state
	loadGameState() {
		return {
			name: localStorage.getItem('bingoName'),
			board: JSON.parse(localStorage.getItem('bingoBoard') || 'null'),
			marked: JSON.parse(localStorage.getItem('bingoMarked') || '[]'),
			exchangeUsed: localStorage.getItem('exchangeUsed') === 'true'
		};
	},
	
	// Save timer state (running, start time, elapsed time)
	saveTimerState({ running, startMs, elapsedMs }) {
		if (running !== undefined) {
			localStorage.setItem('timerRunning', String(running));
		}
		if (startMs !== undefined) {
			if (startMs != null) {
				localStorage.setItem('timerStartMs', String(startMs));
			} else {
				localStorage.removeItem('timerStartMs');
			}
		}
		if (elapsedMs !== undefined) {
			if (elapsedMs != null) {
				localStorage.setItem('timerElapsedMs', String(elapsedMs));
			} else {
				localStorage.removeItem('timerElapsedMs');
			}
		}
	},
	
	// Load timer state
	loadTimerState() {
		return {
			running: localStorage.getItem('timerRunning') === 'true',
			startMs: localStorage.getItem('timerStartMs'),
			elapsedMs: localStorage.getItem('timerElapsedMs')
		};
	},
	
	// Clear all game state
	clearGameState() {
		localStorage.removeItem('bingoName');
		localStorage.removeItem('bingoBoard');
		localStorage.removeItem('bingoMarked');
		localStorage.removeItem('exchangeUsed');
		localStorage.removeItem('timerRunning');
		localStorage.removeItem('timerStartMs');
		localStorage.removeItem('timerElapsedMs');
	}
};

// Debounced save marked state (only saves after user stops clicking for 500ms)
let saveMarkedStateTimeout = null;
function saveMarkedState() {
	// Clear existing timeout
	if (saveMarkedStateTimeout) {
		clearTimeout(saveMarkedStateTimeout);
	}
	
	// Set new timeout to save after 500ms of inactivity
	saveMarkedStateTimeout = setTimeout(() => {
		const marked = [];
		// get marked cells
		document.querySelectorAll('.cell').forEach((cell, index) => {
			if (cell.classList.contains('marked')) marked.push(index);
		});
		
		// Only save to localStorage for single player games (multiplayer state comes from server)
		if (!isMultiplayer) {
			StorageManager.saveGameState({ marked });
		}
		
		// If in multiplayer, sync with server (server is source of truth)
		if (isMultiplayer && socket && currentRoomCode) {
			socket.emit('updateMarked', { roomCode: currentRoomCode, marked });
		}
		
		saveMarkedStateTimeout = null;
	}, 500); // 500ms debounce
}

// Legacy function for backward compatibility - only saves for single player
function saveData(name, board) {
	// Only save to localStorage for single player games
	if (!isMultiplayer) {
		StorageManager.saveGameState({ name, board });
	}
}

function loadData() {
	// Load game state
	const gameState = StorageManager.loadGameState();
	const { name, board, marked, exchangeUsed: savedExchangeUsed } = gameState;
	exchangeUsed = savedExchangeUsed;
	
	if (name) nameInput.value = name;
	if (name) welcome.textContent = `Welcome, ${name}!`;
	if (board) {
		// Ensure board is visible before rendering
		if (bingoBoard) {
			bingoBoard.style.display = 'grid';
			bingoBoard.classList.remove('hidden');
		}
		renderBoard(board, marked);
	}
	updateExchangeButtonState();
	updateGameActionButtons(); // Update button visibility after loading board

	// Restore timer state
	const timerState = StorageManager.loadTimerState();
	const { running: timerRunning, startMs: storedStart, elapsedMs: storedElapsed } = timerState;
	
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
		const gameState = StorageManager.loadGameState();
		const board = gameState.board || [];

		// determine index
		const index = Array.from(bingoBoard.children).indexOf(cell);

		// find unused items
		const usedItems = new Set(board);
		const mode = (modeSelect && modeSelect.value) || 'easy';
		const minGrade = getCurrentMinGrade();
		const poolSource = getChallengePool(mode, minGrade);
		const unusedItems = poolSource.filter(item => !usedItems.has(item));

		// prevent exchanging the FREE center in easy mode
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

		// save board (only for single player)
		cell.textContent = newItem;
		if (!isMultiplayer) {
			StorageManager.saveGameState({ board, exchangeUsed: true });
		}
		
		// mark exchange used and disable button
		exchangeUsed = true;
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
	const existingState = StorageManager.loadGameState();
	if (existingState.board) {
		const confirmNew = confirm("Generating a new board will erase your current progress. Continue?");
		if (!confirmNew) return;
	}

	// proceed normally
	const board = generateBoard();
	// Ensure board is visible before rendering
	if (bingoBoard) {
		bingoBoard.style.display = 'grid';
		bingoBoard.classList.remove('hidden');
	}
	renderBoard(board);
	saveData(name, board);
	exchangeUsed = false;
	// Only save to localStorage for single player games
	if (!isMultiplayer) {
		StorageManager.saveGameState({ marked: [], exchangeUsed: false });
	}
	updateExchangeButtonState();
	updateGameActionButtons(); // Show buttons after generating board
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

// Helper function to toggle visibility using classes (simplified - no dynamic height calculations)
function toggleVisibility(element, show) {
	if (!element) return;
	if (show) {
		element.classList.remove('hidden');
		// Remove inline display style that might override classes
		element.style.removeProperty('display');
	} else {
		element.classList.add('hidden');
	}
}

// Unified mode switch handler - consolidates single/multiplayer switching logic
function switchMode(mode) {
	// Clear any pending saveMarkedState timeout
	if (saveMarkedStateTimeout) {
		clearTimeout(saveMarkedStateTimeout);
		saveMarkedStateTimeout = null;
	}
	
	// Update mode state
	isMultiplayer = (mode === 'multi');
	
	// Update button active states
	if (singlePlayerBtn && multiplayerBtn) {
		if (mode === 'single') {
			singlePlayerBtn.classList.add('active');
			multiplayerBtn.classList.remove('active');
		} else {
			multiplayerBtn.classList.add('active');
			singlePlayerBtn.classList.remove('active');
		}
	}
	
	// Toggle control visibility
	toggleVisibility(singlePlayerControls, mode === 'single');
	toggleVisibility(multiplayerControls, mode === 'multi');
	toggleVisibility(lockoutToggle, mode === 'multi');
	
	// Hide multiplayer-specific UI elements
	toggleVisibility(roomInfo, false);
	toggleVisibility(leaderboard, false);
	hideLobby();
	
	// Reset multiplayer state
	currentRoomCode = null;
	isHost = false;
	roomStartTime = null;
	
	// Hide multiplayer-specific UI elements
	const multiplayerUIElements = ['lockOutStats', 'countdownMode', 'lockConfirm', 'recapLog'];
	multiplayerUIElements.forEach(id => {
		toggleVisibility(document.getElementById(id), false);
	});
	
	// Reset game mode state
	currentMode = null;
	lockedTiles = new Map();
	lockCounts = { myLocks: 0, opponentLocks: 0 };
	confirmingTileIndex = null;
	
	if (mode === 'single') {
		// Single player mode specific logic
		// Stop any running timer first (ensures timer interval is cleared)
		stopTimer();
		
		// Exit exchange mode if active
		if (exchangeMode) {
			exitExchangeMode();
		}
		
		// Disconnect socket
		if (socket) {
			socket.disconnect();
			socket = null;
		}
		
		// Update button visibility (will hide buttons since board not visible yet)
		updateGameActionButtons();
		
		// Restore single player board if it exists in localStorage
		restoreSinglePlayerBoard();
	} else {
		// Multiplayer mode specific logic
		// Stop any running timer first (ensures timer interval is cleared)
		stopTimer();
		
		// Exit exchange mode if active
		if (exchangeMode) {
			exitExchangeMode();
		}
		
		// Reset single player game state
		toggleVisibility(bingoBoard, false);
		if (bingoBoard) bingoBoard.innerHTML = '';
		updateGameActionButtons(); // Hide buttons when switching to multiplayer
		toggleVisibility(timerEl, false);
		exchangeMode = false;
		exchangeUsed = false;
		
		// Socket will be initialized when user creates/joins a room
		// No need to initialize here - keeps single player offline-capable
	}
}

// Helper function to restore single player board from localStorage
function restoreSinglePlayerBoard() {
	const gameState = StorageManager.loadGameState();
	const { board, marked, name: savedName } = gameState;
	
	if (board && Array.isArray(board) && board.length === 25) {
		try {
			// Restore the board - ensure display is set BEFORE rendering
			if (bingoBoard) {
				bingoBoard.style.display = 'grid';
				bingoBoard.classList.remove('hidden');
				renderBoard(board, marked || []);
				
				// Restore timer state (same logic as loadData)
				const timerState = StorageManager.loadTimerState();
				const { running: timerRunning, startMs: storedStart, elapsedMs: storedElapsed } = timerState;
				
				if (timerRunning && storedStart) {
					// Resume running timer
					timerStartMs = parseInt(storedStart, 10);
					updateTimer();
					if (!timerInterval) timerInterval = setInterval(updateTimer, 1000);
					if (timerEl) {
						toggleVisibility(timerEl, true);
						timerEl.style.display = 'block';
					}
				} else if (!timerRunning && storedElapsed) {
					// Show final elapsed without running
					const totalSeconds = Math.floor(parseInt(storedElapsed, 10) / 1000);
					const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
					const seconds = String(totalSeconds % 60).padStart(2, '0');
					if (timerEl) {
						timerEl.textContent = `${minutes}:${seconds}`;
						toggleVisibility(timerEl, true);
						timerEl.style.display = 'block';
					}
				} else {
					// No timer state, start fresh
					if (timerEl) {
						toggleVisibility(timerEl, true);
						timerEl.style.display = 'block';
					}
				}
				
				// Restore exchange button state
				exchangeUsed = gameState.exchangeUsed;
				updateExchangeButtonState();
				updateGameActionButtons(); // Update button visibility after restoring board
				
				// Show welcome message
				if (welcome && savedName) {
					welcome.textContent = `Welcome, ${savedName}!`;
				}
			}
		} catch (e) {
			console.error('Error restoring board:', e);
			// If restoration fails, clear localStorage and show empty state
			StorageManager.clearGameState();
			if (bingoBoard) {
				toggleVisibility(bingoBoard, false);
				bingoBoard.innerHTML = '';
			}
		}
	} else if (board) {
		// Board exists but is invalid, clear it
		console.warn('Invalid board in localStorage, clearing. Board length:', board ? board.length : 'null');
		StorageManager.clearGameState();
		if (bingoBoard) {
			toggleVisibility(bingoBoard, false);
			bingoBoard.innerHTML = '';
		}
	} else {
		// No saved board, hide the board
		if (bingoBoard) {
			toggleVisibility(bingoBoard, false);
			bingoBoard.innerHTML = '';
		}
	}
}

// Mode switch button handlers
if (singlePlayerBtn && multiplayerBtn) {
	singlePlayerBtn.addEventListener('click', () => switchMode('single'));
	multiplayerBtn.addEventListener('click', () => switchMode('multi'));
}

// Create room

// Create room
if (createRoomBtn) {
	createRoomBtn.addEventListener('click', async () => {
		const name = nameInput.value.trim();
		if (!name) {
			alert('Please enter your name first!');
			return;
		}
		
		let mode = getCurrentMode(); // Get easy/hard mode
		const minGrade = getCurrentMinGrade();
		
		// If lock-out is selected, combine it with the mode
		// Format: 'lock-out-easy' or 'lock-out-hard'
		if (isLockOutMode()) {
			mode = `lock-out-${mode}`;
		}
		
		// Ensure socket is ready before emitting
		const connected = await ensureSocketReady();
		if (!connected) {
			alert('Failed to connect to server. Please check your connection and try again.');
			return;
		}
		
		socket.emit('createRoom', { name, mode, minGrade });
	});
}

// Join room
if (joinRoomBtn) {
	joinRoomBtn.addEventListener('click', async () => {
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
		
		// Ensure socket is ready before emitting
		const connected = await ensureSocketReady();
		if (!connected) {
			alert('Failed to connect to server. Please check your connection and try again.');
			return;
		}
		
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
	toggleVisibility(document.getElementById('lockConfirm'), true);
}

function cancelTileConfirmation() {
	if (confirmingTileIndex !== null) {
		const cell = bingoBoard.children[confirmingTileIndex];
		if (cell) {
			cell.classList.remove('confirming');
		}
		confirmingTileIndex = null;
	}
	toggleVisibility(document.getElementById('lockConfirm'), false);
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
	toggleVisibility(document.getElementById('countdownMode'), false);
}

function showRecapLog(lockHistory) {
	const recapLog = document.getElementById('recapLog');
	const recapList = document.getElementById('recapList');
	
	if (!recapLog || !recapList) return;
	
	recapList.innerHTML = '';
	
	if (!lockHistory || lockHistory.length === 0) {
		recapList.innerHTML = '<li>No locks recorded</li>';
		toggleVisibility(recapLog, true);
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
	
	toggleVisibility(recapLog, true);
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

// Hide tooltip when clicking elsewhere
document.addEventListener('click', (e) => {
	if (currentTooltipCell && !currentTooltipCell.contains(e.target)) {
		const tooltip = document.getElementById('challengeTooltip');
		if (tooltip && !tooltip.contains(e.target)) {
			toggleVisibility(tooltip, false);
		}
		currentTooltipCell = null;
	}
});

// Hide tooltip on scroll
document.addEventListener('scroll', () => {
	const tooltip = document.getElementById('challengeTooltip');
	if (tooltip) {
		toggleVisibility(tooltip, false);
	}
	currentTooltipCell = null;
}, true);

// Initialize UI state on page load
function initializeUIState() {
	// Ensure single player controls are visible by default (single player is default)
	toggleVisibility(singlePlayerControls, true);
	toggleVisibility(multiplayerControls, false);
	
	// Hide elements that should be hidden by default
	toggleVisibility(leaderboard, false);
	toggleVisibility(document.getElementById('lobby'), false);
	toggleVisibility(document.getElementById('lockOutStats'), false);
	toggleVisibility(document.getElementById('countdownMode'), false);
	toggleVisibility(document.getElementById('lockConfirm'), false);
	toggleVisibility(document.getElementById('recapLog'), false);
	toggleVisibility(document.getElementById('roomInfo'), false);
	toggleVisibility(document.getElementById('challengeTooltip'), false);
	
	// Initialize button visibility state
	updateGameActionButtons();
}

// Use DOMContentLoaded for faster initialization (runs earlier than 'load')
// This runs before images/stylesheets are fully loaded, allowing us to set height before render
document.addEventListener('DOMContentLoaded', () => {
	initializeUIState();
	loadData();
});
