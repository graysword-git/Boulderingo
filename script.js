// ============================================
// DOM ELEMENTS
// ============================================

const nameInput = document.getElementById('nameInput');
const generateBtn = document.getElementById('generateBtn');
const bingoBoard = document.getElementById('bingoBoard');
const welcome = document.getElementById('welcome');
const exchangeBtn = document.getElementById('exchangeBtn');
const timer = document.getElementById('timer');
const verifyBtn = document.getElementById('verifyBtn');
const modeSelect = document.getElementById('modeSelect');
const minGradeSelect = document.getElementById('minGradeSelect');
const lockoutRadio = document.getElementById('lockoutRadio');
const normalRadio = document.getElementById('normalRadio');
const container = document.getElementById('container');
const lobby = document.getElementById('lobby');
const lobbyPlayersList = document.getElementById('lobbyPlayers');
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

// ============================================
// STATE VARIABLES
// ============================================

let socket = null;
let isMultiplayer = false;
let currentRoomCode = null;
let roomStartTime = null;
let isHost = false;
let lobbyPlayers = [];
let currentMode = 'easy';
let lockedTiles = new Map(); // tileIndex → {playerId, playerName, timestamp}
let confirmingTileIndex = null;
let lockCounts = { myLocks: 0, opponentLocks: 0 };
let countdownEndTime = null;
let countdownInterval = null;
let timerInterval = null;
let timerStartMs = null;
let exchangeMode = false;
let exchangeUsed = false;
let currentMinGrade = 'green';

// ============================================
// CONSTANTS & CONFIG
// ============================================

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
];

const HARD_CHALLENGES = [
	"E-limb-ination",
	"Orange tag -1 hold",
	"Graysword Kilter 40°",
	"Campus",
	"Feet b4 hands"
];

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

const GRADE_ORDER = {
  pink: { name: 'Pink', order: 1 },
  yellow: { name: 'Yellow', order: 2 },
  green: { name: 'Green', order: 3 },
  orange: { name: 'Orange', order: 4 },
  blue: { name: 'Blue', order: 5 }
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

function getCurrentMode() {
  return modeSelect ? modeSelect.value : 'easy';
}

// Helper: Check if a mode string is lock-out mode
function isLockOutModeString(mode) {
	return mode === 'lock-out' || (typeof mode === 'string' && mode.startsWith('lock-out-'));
}

function isLockOutMode() {
	// Single player: check radio button (UI source of truth)
	if (!isMultiplayer) {
		return lockoutRadio && lockoutRadio.checked;
	}
	// Multiplayer: check currentMode (server source of truth)
	if (isMultiplayer && currentMode) {
		return isLockOutModeString(currentMode);
	}
	// Fallback to radio button
	return lockoutRadio && lockoutRadio.checked;
}

function getCurrentMinGrade() {
  return minGradeSelect ? minGradeSelect.value : 'green';
}

function getChallengeExplanation(challengeText) {
	if (!challengeText) return null;
	
	if (CHALLENGE_EXPLANATIONS[challengeText]) {
		return CHALLENGE_EXPLANATIONS[challengeText];
	}
	
	// try partial matches
	for (const [key, value] of Object.entries(CHALLENGE_EXPLANATIONS)) {
		if (challengeText.includes(key) || key.includes(challengeText)) {
			return value;
		}
	}
	
	return null;
}

function formatMs(ms) {
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
	const seconds = String(totalSeconds % 60).padStart(2, '0');
	return `${minutes}:${seconds}`;
}

function toggleVisibility(element, show) {
	if (!element) return;
	if (show) {
		element.classList.remove('hidden');
		element.style.removeProperty('display');
	} else {
		element.classList.add('hidden');
	}
}

// ============================================
// UI UPDATES
// ============================================

function updateGameActionButtons() {
  const boardHasContent = bingoBoard && bingoBoard.children.length > 0;
  const boardDisplayStyle = bingoBoard ? bingoBoard.style.display : '';
  const boardIsHidden = boardDisplayStyle === 'none';
  const boardVisible = boardHasContent && !boardIsHidden;
  
  const isLockout = isLockOutMode();
  const shouldShow = boardVisible && !isLockout;
  
  if (verifyBtn) {
    toggleVisibility(verifyBtn, shouldShow);
    if (shouldShow) {
      verifyBtn.style.display = 'inline-block';
    }
  }
  
  if (exchangeBtn) {
    toggleVisibility(exchangeBtn, shouldShow);
    if (shouldShow) {
      exchangeBtn.style.display = 'inline-block';
    }
  }
}

function updateWelcomeMessage() {
	if (!welcome) return;
	const gradeName = GRADE_ORDER[currentMinGrade]?.name || 'Green';
	welcome.textContent = `Minimum Grade : ${gradeName}`;
	toggleVisibility(welcome, true);
}

function showBoard() {
	if (bingoBoard) {
		bingoBoard.style.display = 'grid';
		bingoBoard.classList.remove('hidden');
	}
}

// Update exchange button disabled state based on exchangeUsed
function updateExchangeButtonState() {
	if (!exchangeBtn) return;
	exchangeBtn.disabled = !!exchangeUsed;
	exchangeBtn.style.opacity = exchangeUsed ? '0.5' : '';
	exchangeBtn.style.cursor = exchangeUsed ? 'not-allowed' : 'pointer';
}

// scale height of multiplayer section based on visible content
function updateMultiplayerSectionHeight() {
	const section = document.querySelector('.multiplayer-section');
	if (!section) return;
	
	const modeToggle = document.querySelector('.game-mode-toggle');
	const lockoutToggle = document.getElementById('lockoutToggle');
	const singlePlayerControls = document.getElementById('singlePlayerControls');
	const multiplayerControls = document.getElementById('multiplayerControls');
	
	let maxBottom = 0;
	
	if (modeToggle) {
		const modeToggleRect = modeToggle.getBoundingClientRect();
		const sectionRect = section.getBoundingClientRect();
		const modeToggleBottom = (modeToggleRect.bottom - sectionRect.top) + modeToggle.offsetHeight;
		maxBottom = Math.max(maxBottom, modeToggleBottom);
	}
	
	if (lockoutToggle && !lockoutToggle.classList.contains('hidden')) {
		const lockoutRect = lockoutToggle.getBoundingClientRect();
		const sectionRect = section.getBoundingClientRect();
		const lockoutBottom = (lockoutRect.bottom - sectionRect.top);
		maxBottom = Math.max(maxBottom, lockoutBottom);
	}
	
	if (singlePlayerControls && !singlePlayerControls.classList.contains('hidden')) {
		const controlsRect = singlePlayerControls.getBoundingClientRect();
		const sectionRect = section.getBoundingClientRect();
		const controlsBottom = (controlsRect.bottom - sectionRect.top);
		maxBottom = Math.max(maxBottom, controlsBottom);
	}
	
	if (multiplayerControls && !multiplayerControls.classList.contains('hidden')) {
		const controlsRect = multiplayerControls.getBoundingClientRect();
		const sectionRect = section.getBoundingClientRect();
		
		let maxChildBottom = controlsRect.bottom - sectionRect.top;
		
		const children = multiplayerControls.children;
		for (let i = 0; i < children.length; i++) {
			const child = children[i];
			const style = window.getComputedStyle(child);
			if (style.display !== 'none' && !child.classList.contains('hidden')) {
				const childRect = child.getBoundingClientRect();
				const childBottom = childRect.bottom - sectionRect.top;
				maxChildBottom = Math.max(maxChildBottom, childBottom);
			}
		}
		
		maxBottom = Math.max(maxBottom, maxChildBottom);
	}
	
	const padding = 30;
	const calculatedHeight = maxBottom + padding;
	const minHeight = modeToggle ? Math.max(modeToggle.offsetHeight + 20, 80) : 80;
	section.style.minHeight = `${Math.max(calculatedHeight, minHeight)}px`;
}

// ============================================
// SOCKET.IO
// ============================================

// Helper: Setup lobby UI (used by both roomCreated and roomJoined)
function setupLobbyUI(roomCode, mode, isHostParam, players, minGrade = null) {
	currentRoomCode = roomCode;
	lobbyPlayers = players;
	roomCodeDisplay.textContent = roomCode;
	toggleVisibility(roomInfo, true);
	setTimeout(updateMultiplayerSectionHeight, 0);
	
	// Update UI to match room settings
	const isLockout = isLockOutModeString(mode);
	if (isLockout) {
		if (lockoutRadio) lockoutRadio.checked = true;
		if (normalRadio) normalRadio.checked = false;
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
	
	updateWelcomeMessage();
	showLobby(players, isHostParam);
}

// Helper: Update lobby when player list changes
function handlePlayerListUpdate(name, players, action) {
	lobbyPlayers = players;
	updateLobbyPlayers(players);
	updateStartGameButton();	// in case of host change
	console.log(`${name} ${action} the room`);
}

// Helper: Setup game UI based on mode
function setupGameUI(mode, board, startTime, marked = null, lockedTilesData = null, lockCountsData = null, countdownMode = false, countdownEndTimeParam = null, leaderboardData = null, minGrade = null) {
	roomStartTime = startTime;
	currentMode = mode;
	
	if (minGrade) {
		currentMinGrade = minGrade;
	}
	
	updateWelcomeMessage();
	hideLobby();
	
	// Set mode and render board
	const isLockoutMode = isLockOutModeString(mode);
	if (isLockoutMode) {
		if (lockoutRadio) lockoutRadio.checked = true;
		if (normalRadio) normalRadio.checked = false;
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
	
	// Show common game elements
	showBoard();
	if (timer) {
		toggleVisibility(timer, true);
		timer.style.display = 'block';
	}
	
	// Show lock-out mode UI
	if (isLockoutMode) {
		if (lockedTilesData) {
			lockedTiles = new Map(Object.entries(lockedTilesData).map(([key, value]) => [parseInt(key), value]));
		} else {
			lockedTiles = new Map();
		}
		if (lockCountsData) {
			const myId = socket?.id;
			lockCounts.myLocks = myId ? (lockCountsData[myId] || 0) : 0;
			const opponentId = myId ? Object.keys(lockCountsData).find(id => id !== myId) : null;
			lockCounts.opponentLocks = opponentId ? (lockCountsData[opponentId] || 0) : 0;
		} else {
			lockCounts = { myLocks: 0, opponentLocks: 0 };
		}
		confirmingTileIndex = null;
		updateGameActionButtons();
		toggleVisibility(document.getElementById('lockOutStats'), true);
		updateLockStats();
		
		if (countdownMode && countdownEndTimeParam) {
			countdownEndTime = countdownEndTimeParam;
			toggleVisibility(document.getElementById('countdownMode'), true);
			startCountdown();
		} else {
			toggleVisibility(document.getElementById('countdownMode'), false);
		}
		toggleVisibility(document.getElementById('lockConfirm'), false);
		toggleVisibility(document.getElementById('recapLog'), false);
		toggleVisibility(leaderboard, false);
	} else {
		// Show normal mode UI
		updateGameActionButtons();
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
	
	renderBoard(board, marked || []);
	
	// Save game state for single player
	if (!isMultiplayer) {
		saveData(nameInput.value.trim(), board);
		StorageManager.saveGameState({ marked: marked || [] });
		if (!marked) {
			exchangeUsed = false;
			StorageManager.saveGameState({ exchangeUsed: false });
		}
	}
	updateExchangeButtonState();
	updateGameActionButtons();
	
	timerStartMs = startTime;
	updateTimer();
	if (!timerInterval) timerInterval = setInterval(updateTimer, 1000);
}

function initSocket() {
	if (socket) return socket;
	
	// Determine server URL from data-backend-url attribute or auto-detect
	const backendUrl = (document.body.dataset.backendUrl || '').trim();
	let serverUrl;
	
	if (backendUrl) {
		serverUrl = backendUrl;
	} else if (window.location.protocol === 'file:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
		serverUrl = 'http://localhost:3000';
	} else {
		console.warn('No backend URL configured. Set data-backend-url attribute in <body> tag with your backend URL.');
		serverUrl = window.location.origin;
	}
	
	socket = io(serverUrl);
	
	// Connection Events
	socket.on('connect', () => {
		console.log('Connected to server');
	});
	
	socket.on('disconnect', () => {
		console.log('Disconnected from server');
	});
	
	// Room Events
	socket.on('roomCreated', ({ roomCode, mode, isHost, players, minGrade }) => {
		setupLobbyUI(roomCode, mode, isHost, players, minGrade);
	});
	
	socket.on('roomJoined', ({ roomCode, mode, isHost, players, minGrade }) => {
		setupLobbyUI(roomCode, mode, isHost, players, minGrade);
	});
	
	socket.on('joinError', ({ message }) => {
		alert(`Error: ${message}`);
	});
	
	// Player Events
	socket.on('playerJoined', ({ name, players }) => {
		handlePlayerListUpdate(name, players, 'joined');
	});
	
	socket.on('playerLeft', ({ name, players }) => {
		handlePlayerListUpdate(name, players, 'left');
	});
	
	socket.on('playerRejoined', ({ name, players }) => {
		handlePlayerListUpdate(name, players, 'rejoined');
	});
	
	// Game Events
	socket.on('gameStarted', ({ roomCode, board, mode, startTime, minGrade }) => {
		isMultiplayer = true;
		setupGameUI(mode, board, startTime, null, null, null, false, null, null, minGrade);
	});
	
	socket.on('gameRejoined', ({ roomCode, board, mode, startTime, marked, lockedTiles: serverLockedTiles, lockCounts: serverLockCounts, countdownMode, countdownEndTime, leaderboard: roomLeaderboard, minGrade }) => {
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
	
	// Lock-Out Mode Events
	socket.on('tileLocked', ({ tileIndex, playerId, playerName, timestamp, lockedTiles: serverLockedTiles, lockCounts: serverLockCounts }) => {
		lockedTiles.set(tileIndex, { playerId, playerName, timestamp });
		
		if (serverLockCounts) {
			const myId = socket?.id;
			lockCounts.myLocks = myId ? (serverLockCounts[myId] || 0) : 0;
			const opponentId = myId ? Object.keys(serverLockCounts).find(id => id !== myId) : null;
			lockCounts.opponentLocks = opponentId ? (serverLockCounts[opponentId] || 0) : 0;
		}
		
		updateLockedTileVisual(tileIndex, playerId === socket?.id);
		updateLockStats();
		
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
		const finalTime = timer ? timer.textContent : '';
		highlightWinningLines(getWinningLines());
		
		let message = `🎉 ${winnerName} wins! 🎉\nTime: ${finalTime}`;
		if (winType === 'bingo') {
			message += '\nWin Type: Bingo!';
		}
		alert(message);
		showRecapLog(lockHistory);
	});
	
	socket.on('countdownModeStarted', ({ endTime }) => {
		countdownEndTime = endTime;
		toggleVisibility(document.getElementById('countdownMode'), true);
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
		showRecapLog(lockHistory);
	});
	
	// Leaderboard & Verification Events
	socket.on('leaderboardUpdate', ({ leaderboard: roomLeaderboard }) => {
		renderMultiplayerLeaderboard(roomLeaderboard);
	});
	
	socket.on('verifyResult', ({ valid, elapsedMs, position, message }) => {
		if (valid) {
			stopTimer();
			const finalTime = timer ? timer.textContent : '';
			const lines = getWinningLines();
			highlightWinningLines(lines);
			alert(`🎉 You win! 🎉\nTime: ${finalTime}\nPosition: ${position}`);
		} else {
			if (message) {
				alert(message);
			} else {
				if (container) {
					container.classList.add('verify-fail');
					setTimeout(() => container.classList.remove('verify-fail'), 500);
				}
			}
		}
	});
	
	return socket;
}

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

// ============================================
// TIMER
// ============================================

function stopTimer() {
	if (timerInterval) {
		clearInterval(timerInterval);
		timerInterval = null;
	}
	if (!isMultiplayer) {
		if (timerStartMs != null) {
			const stoppedElapsed = Date.now() - timerStartMs;
			StorageManager.saveTimerState({ running: false, elapsedMs: stoppedElapsed });
		} else {
			StorageManager.saveTimerState({ running: false });
		}
	}
}

function updateTimer() {
	if (timerStartMs == null) return;
	const elapsed = Date.now() - timerStartMs;
	const totalSeconds = Math.floor(elapsed / 1000);
	const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
	const seconds = String(totalSeconds % 60).padStart(2, '0');
	if (timer) timer.textContent = `${minutes}:${seconds}`;
}

function startTimer() {
	stopTimer();
	timerStartMs = Date.now();
	if (timer) timer.textContent = '00:00';
	timerInterval = setInterval(updateTimer, 1000);
	if (!isMultiplayer) {
		StorageManager.saveTimerState({ running: true, startMs: timerStartMs, elapsedMs: null });
	}
}

// ============================================
// LOBBY
// ============================================

function hideGameElements() {
	toggleVisibility(bingoBoard, false);
	updateGameActionButtons();
	toggleVisibility(leaderboard, false);
	toggleVisibility(timer, false);
	toggleVisibility(document.getElementById('lockOutStats'), false);
	toggleVisibility(document.getElementById('countdownMode'), false);
	toggleVisibility(document.getElementById('lockConfirm'), false);
	toggleVisibility(document.getElementById('recapLog'), false);
}

function showLobby(players, hostStatus) {
	isHost = hostStatus;
	lobbyPlayers = players;
	
	hideGameElements();
	
	if (lobby) {
		toggleVisibility(lobby, true);
		updateLobbyPlayers(players);
		updateStartGameButton();
	}
	
	setTimeout(updateMultiplayerSectionHeight, 0);
}

function hideLobby() {
	toggleVisibility(lobby, false);
	setTimeout(updateMultiplayerSectionHeight, 0);
}

function updateLobbyPlayers(players) {
	if (lobbyPlayersList) {
		lobbyPlayersList.innerHTML = '';
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
			lobbyPlayersList.appendChild(li);
		});
	}
	
	if (roomPlayers) {
		roomPlayers.textContent = `Players: ${players.length}`;
	}
	
	setTimeout(updateMultiplayerSectionHeight, 0);
}

function updateStartGameButton() {
	const startGameBtn = document.getElementById('startGameBtn');
	const waitingForHost = document.getElementById('waitingForHost');
	
	if (startGameBtn) {
		toggleVisibility(startGameBtn, isHost);
		if (isHost) {
			startGameBtn.style.display = 'block';
		} else {
			startGameBtn.style.removeProperty('display');
		}
		startGameBtn.disabled = false;
		startGameBtn.textContent = 'Start Game';
	}
	if (waitingForHost) {
		toggleVisibility(waitingForHost, !isHost);
		if (!isHost) {
			waitingForHost.style.display = 'block';
		} else {
			waitingForHost.style.removeProperty('display');
		}
	}
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

function getChallengePool(mode = null, minGrade = null) {
	const currentMode = mode || (modeSelect && modeSelect.value) || 'easy';
	const currentMinGrade = minGrade || getCurrentMinGrade();
	
	let pool = currentMode === 'hard' ? [...CHALLENGES, ...HARD_CHALLENGES] : [...CHALLENGES];
	
	// Add dynamic "Pinks b2b" challenge based on mode
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
	const mode = (modeSelect && modeSelect.value) || 'easy';
	const minGrade = getCurrentMinGrade();
	const poolSource = getChallengePool(mode, minGrade);
	const validItems = poolSource.filter(item => item.trim() !== "" && item !== "—");
	const pool = validItems;
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

// ============================================
// TOOLTIP MANAGEMENT
// ============================================

let currentTooltipCell = null;
const LONG_PRESS_DURATION = 500;

function setupChallengeTooltip(cell, challengeText) {
	const tooltip = document.getElementById('challengeTooltip');
	const tooltipTitle = document.getElementById('tooltipTitle');
	const tooltipText = document.getElementById('tooltipText');
	
	if (!tooltip || !tooltipTitle || !tooltipText) return;
	
	let cellPressTimer = null;
	let cellPressStartTime = 0;
	let cellTooltipShown = false;
	
	function showTooltip(e) {
		const explanation = getChallengeExplanation(challengeText);
		if (!explanation) {
			return;
		}
		
		tooltipTitle.textContent = challengeText;
		tooltipText.textContent = explanation;
		toggleVisibility(tooltip, true);
		tooltip.style.display = 'block';
		
		const rect = cell.getBoundingClientRect();
		const tooltipRect = tooltip.getBoundingClientRect();
		const scrollY = window.scrollY || window.pageYOffset;
		const scrollX = window.scrollX || window.pageXOffset;
		
		let top = rect.top + scrollY - tooltipRect.height - 10;
		let left = rect.left + scrollX + (rect.width / 2) - (tooltipRect.width / 2);
		
		if (top < scrollY + 10) {
			top = rect.bottom + scrollY + 10;
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
	
	cell.addEventListener('pointerdown', (e) => {
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
		
		if (cellTooltipShown || pressDuration >= LONG_PRESS_DURATION) {
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
		if (Date.now() - cellPressStartTime < LONG_PRESS_DURATION) {
			hideTooltip();
		}
	});
	
	cell.addEventListener('contextmenu', (e) => {
		e.preventDefault();
		showTooltip(e);
	});
	
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
		cancelPressTimer();
		hideTooltip();
	}, { passive: true });
}

// ============================================
// GAME LOGIC - BOARD RENDERING
// ============================================

function renderBoard(board, marked = []) {
	bingoBoard.innerHTML = '';
	
	const isLockoutMode = isLockOutModeString(currentMode);
	
	board.forEach((text, index) => {
		const cell = document.createElement('div');
		cell.className = 'cell';
		cell.textContent = text || "";
		cell.dataset.tileIndex = index;
		cell.dataset.challengeText = text;
		
		if (text === 'FREE') cell.classList.add('marked');
		
		setupChallengeTooltip(cell, text);
		
		// Apply marked state based on mode
		if (isLockoutMode) {
			const lock = lockedTiles.get(index);
			if (lock) {
				cell.classList.add(lock.playerId === socket?.id ? 'marked' : 'locked-by-opponent');
			}
		} else {
			if (marked.includes(index)) cell.classList.add('marked');
		}
		
		setupCellClickHandler(cell, index, isLockoutMode);
		
		bingoBoard.appendChild(cell);
	});
}

function setupCellClickHandler(cell, index, isLockoutMode) {
	let pressStartTime = 0;
	
	cell.addEventListener('pointerdown', () => {
		pressStartTime = Date.now();
	});
	
	cell.addEventListener('click', (e) => {
		const pressDuration = Date.now() - pressStartTime;
		if (cell.dataset.tooltipActive === 'true' || pressDuration >= LONG_PRESS_DURATION) {
			e.preventDefault();
			e.stopPropagation();
			cell.dataset.tooltipActive = 'false';
			return;
		}
		
		if (exchangeMode) return;
		if (cell.textContent === 'FREE') return;
		
		if (isLockoutMode) {
			if (lockedTiles.has(index)) return;
			if (confirmingTileIndex === index) return;
			startTileConfirmation(index);
		} else {
			cell.classList.toggle('marked');
			saveMarkedState();
		}
	});
}

// ============================================
// STORAGE
// ============================================

const StorageManager = {
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
	
	loadGameState() {
		return {
			name: localStorage.getItem('bingoName'),
			board: JSON.parse(localStorage.getItem('bingoBoard') || 'null'),
			marked: JSON.parse(localStorage.getItem('bingoMarked') || '[]'),
			exchangeUsed: localStorage.getItem('exchangeUsed') === 'true'
		};
	},
	
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
	
	loadTimerState() {
		return {
			running: localStorage.getItem('timerRunning') === 'true',
			startMs: localStorage.getItem('timerStartMs'),
			elapsedMs: localStorage.getItem('timerElapsedMs')
		};
	},
	
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
		if (isMultiplayer && socket && socket.connected && currentRoomCode) {
			socket.emit('updateMarked', { roomCode: currentRoomCode, marked });
		}
		
		saveMarkedStateTimeout = null;
	}, 500);
}

function saveData(name, board) {
	if (!isMultiplayer) {
		StorageManager.saveGameState({ name, board });
	}
}

function loadData() {
	const gameState = StorageManager.loadGameState();
	const { name, board, marked, exchangeUsed: savedExchangeUsed } = gameState;
	exchangeUsed = savedExchangeUsed;
	
	if (name) nameInput.value = name;
	updateWelcomeMessage();
	if (board) {
		showBoard();
		renderBoard(board, marked);
	}
	updateExchangeButtonState();
	updateGameActionButtons();

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
		if (timer) timer.textContent = `${minutes}:${seconds}`;
	}
}

// ============================================
// EXCHANGE FUNCTIONALITY
// ============================================

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

		const gameState = StorageManager.loadGameState();
		const board = gameState.board || [];

		const index = Array.from(bingoBoard.children).indexOf(cell);

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
			bingoBoard.removeEventListener('click', handleExchangeClick);
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

// ============================================
// GAME LOGIC - BINGO CHECKING
// ============================================

function getMarkedSet() {
	const marked = new Set();
	document.querySelectorAll('.cell').forEach((cell, index) => {
		if (cell.classList.contains('marked')) marked.add(index);
	});
	return marked;
}

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

// ============================================
// EVENT HANDLERS
// ============================================

generateBtn.addEventListener('click', () => {
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

	const board = generateBoard();
	showBoard();
	renderBoard(board);
	saveData(name, board);
	exchangeUsed = false;
	
	// Only save to localStorage for single player games
	if (!isMultiplayer) {
		StorageManager.saveGameState({ marked: [], exchangeUsed: false });
	}
	updateExchangeButtonState();
	updateGameActionButtons();
	updateWelcomeMessage();
	startTimer();
});

if (verifyBtn) {
	verifyBtn.addEventListener('click', () => {
		const marked = [];
		document.querySelectorAll('.cell').forEach((cell, index) => {
			if (cell.classList.contains('marked')) marked.push(index);
		});
		
		if (isMultiplayer && socket && socket.connected && currentRoomCode) {
			socket.emit('verifyBingo', { roomCode: currentRoomCode, marked });
		} else {
			if (hasBingo()) {
				stopTimer();
				const finalTime = timer ? timer.textContent : '';
				const lines = getWinningLines();
				highlightWinningLines(lines);
				alert(`🎉 You win! 🎉\nTime: ${finalTime}`);
				return;
			}
			if (container) {
				container.classList.add('verify-fail');
				setTimeout(() => container.classList.remove('verify-fail'), 500);
			}
		}
	});
}

// ============================================
// MODE SWITCHING
// ============================================

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

	updateWelcomeMessage();
	
	// Update section height after mode switch (hideLobby already calls it, but ensure it's called)
	setTimeout(updateMultiplayerSectionHeight, 0);
	
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
	countdownEndTime = null;
	
	if (mode === 'single') {
		stopTimer();
		stopCountdown();
		
		if (exchangeMode) {
			exitExchangeMode();
		}
		
		currentMinGrade = getCurrentMinGrade();
		
		if (socket) {
			socket.disconnect();
			socket = null;
		}
		
		updateGameActionButtons();
		restoreSinglePlayerBoard();
	} else {
		// Multiplayer mode specific logic
		stopTimer();
		stopCountdown();
		
		if (exchangeMode) {
			exitExchangeMode();
		}
		
		toggleVisibility(bingoBoard, false);
		if (bingoBoard) bingoBoard.innerHTML = '';
		updateGameActionButtons();
		toggleVisibility(timer, false);
		exchangeMode = false;
		exchangeUsed = false;
	}
}

// Helper function to restore single player board from localStorage
function restoreSinglePlayerBoard() {
	const gameState = StorageManager.loadGameState();
	const { board, marked, name: savedName } = gameState;
	
	if (board && Array.isArray(board) && board.length === 25) {
		try {
			showBoard();
			renderBoard(board, marked || []);
			
			const timerState = StorageManager.loadTimerState();
			const { running: timerRunning, startMs: storedStart, elapsedMs: storedElapsed } = timerState;
			
			if (timerRunning && storedStart) {
				// Resume running timer
				timerStartMs = parseInt(storedStart, 10);
				updateTimer();
				if (!timerInterval) timerInterval = setInterval(updateTimer, 1000);
				if (timer) {
					toggleVisibility(timer, true);
					timer.style.display = 'block';
				}
			} else if (!timerRunning && storedElapsed) {
				// Show final elapsed without running
				const totalSeconds = Math.floor(parseInt(storedElapsed, 10) / 1000);
				const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
				const seconds = String(totalSeconds % 60).padStart(2, '0');
				if (timer) {
					timer.textContent = `${minutes}:${seconds}`;
					toggleVisibility(timer, true);
					timer.style.display = 'block';
				}
			} else {
				// No timer state, start fresh
				if (timer) {
					toggleVisibility(timer, true);
					timer.style.display = 'block';
				}
			}
			
			exchangeUsed = gameState.exchangeUsed;
			updateExchangeButtonState();
			updateGameActionButtons();
			updateWelcomeMessage();
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

// ============================================
// LOCK-OUT MODE
// ============================================

if (createRoomBtn) {
	createRoomBtn.addEventListener('click', async () => {
		const name = nameInput.value.trim();
		if (!name) {
			alert('Please enter your name first!');
			return;
		}
		
		let mode = getCurrentMode();
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

// ============================================
// INITIALIZATION
// ============================================

const lockoutToggle = document.getElementById('lockoutToggle');
if (lockoutToggle) {
	toggleVisibility(lockoutToggle, false);
}

if (singlePlayerBtn && multiplayerBtn) {
	singlePlayerBtn.addEventListener('click', () => switchMode('single'));
	multiplayerBtn.addEventListener('click', () => switchMode('multi'));
}

const confirmLockBtn = document.getElementById('confirmLockBtn');
const cancelLockBtn = document.getElementById('cancelLockBtn');
if (confirmLockBtn) {
	confirmLockBtn.addEventListener('click', confirmTileLock);
}
if (cancelLockBtn) {
	cancelLockBtn.addEventListener('click', cancelTileConfirmation);
}

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

function initializeUIState() {
	// Ensure single player controls are visible by default (single player is default)
	toggleVisibility(singlePlayerControls, true);
	toggleVisibility(multiplayerControls, false);
	
	// Hide elements that should be hidden by default
	toggleVisibility(leaderboard, false);
	toggleVisibility(lobby, false);
	toggleVisibility(document.getElementById('lockOutStats'), false);
	toggleVisibility(document.getElementById('countdownMode'), false);
	toggleVisibility(document.getElementById('lockConfirm'), false);
	toggleVisibility(document.getElementById('recapLog'), false);
	toggleVisibility(document.getElementById('roomInfo'), false);
	toggleVisibility(document.getElementById('challengeTooltip'), false);
	toggleVisibility(timer, false);
	updateWelcomeMessage();
	
	updateGameActionButtons();
	setTimeout(updateMultiplayerSectionHeight, 0);
}

document.addEventListener('DOMContentLoaded', () => {
	initializeUIState();
	loadData();
});
