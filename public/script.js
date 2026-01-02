const socket = io();
const GAME_PASSWORD = 'pablo2101'; 

// VARIABLES
let currentPlayer = null;
let currentEvents = []; 
let currentHofData = null;
let attempts = 0;
let isDuel = false; 
let isInLobby = false;

document.addEventListener('DOMContentLoaded', () => { loadPlayers(); });

// --- 1. LOGIN ---
async function loadPlayers() {
    try {
        const res = await fetch('/api/players');
        const players = await res.json();
        const select = document.getElementById('player-select');
        select.innerHTML = '<option value="">Elige tu nombre...</option>';
        players.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.name;
            opt.textContent = p.name;
            select.appendChild(opt);
        });
    } catch (e) { console.error(e); }
}

function login() {
    const name = document.getElementById('player-select').value;
    const pass = document.getElementById('password-input').value;

    if (!name) return Swal.fire('Error', 'Elige nombre', 'warning');
    if (pass !== GAME_PASSWORD) return Swal.fire('Error', 'Contraseña incorrecta', 'error');

    currentPlayer = name;
    document.getElementById('welcome-msg').textContent = `Hola, ${currentPlayer}`;
    showScreen('menu-screen');
    socket.emit('login-user', currentPlayer);
}

// --- 2. MULTIJUGADOR ---
function enterDuelLobby() {
    if (!currentPlayer) return;
    showScreen('lobby-screen');
    socket.emit('join-lobby', currentPlayer);
    isInLobby = true;
}
function leaveLobby() {
    socket.emit('leave-lobby');
    isInLobby = false;
    showScreen('menu-screen');
}
socket.on('update-lobby', (players) => {
    if (!isInLobby) return;
    const list = document.getElementById('lobby-players-list');
    if(list) list.innerHTML = players.map(p => `<div>👤 ${p.name}</div>`).join('');
});
function startMultiDuel() {
    const difficulty = document.getElementById('lobby-difficulty').value;
    socket.emit('start-multiduel', difficulty);
}
socket.on('multiduel-start', (events) => {
    isDuel = true;
    attempts = 0;
    currentEvents = events;
    renderGame("⚔️ DUELO EN MARCHA");
    Swal.fire({ title: '¡A JUGAR!', timer: 1000, showConfirmButton: false });
});
socket.on('player-finished', (data) => {
    if (data.name !== currentPlayer) Swal.fire('Info', `${data.name} ha terminado.`, 'info');
});

// --- 3. JUEGO SOLO ---
async function setupGame(mode) {
    isDuel = false;
    if (mode === 'solo') {
        const isJunior = document.getElementById('mode-junior') ? document.getElementById('mode-junior').checked : false;
        
        const { value: count } = await Swal.fire({
            title: isJunior ? 'Modo Junior ⭐' : 'Modo Normal',
            input: 'range',
            inputLabel: '¿Cuántas cartas?',
            inputAttributes: { min: 2, max: 10, step: 1 },
            inputValue: 3
        });
        
        if (count) startGameSolo(count, isJunior ? 'easy' : 'normal');
    }
}

async function startGameSolo(count, difficulty) {
    Swal.fire({title: 'Cargando...', didOpen: () => Swal.showLoading()});
    try {
        const res = await fetch(`/api/game?count=${count}&difficulty=${difficulty}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        
        currentEvents = data;
        renderGame(difficulty === 'easy' ? "Nivel Junior ⭐" : "Nivel Maestro");
        Swal.close();
    } catch(e) { Swal.fire('Ups', e.message, 'error'); }
}

function renderGame(title) {
    document.getElementById('game-mode-title').textContent = title;
    const container = document.getElementById('cards-container');
    container.innerHTML = '';
    showScreen('game-screen');
    
    [...currentEvents].sort(() => Math.random() - 0.5).forEach(evt => {
        const div = document.createElement('div');
        div.className = 'event-card';
        div.draggable = true;
        div.dataset.id = evt._id;
        const img = evt.imageUrl ? `<img src="${evt.imageUrl}">` : '';
        div.innerHTML = `<div style="display:flex;align-items:center">${img}<strong>${evt.title}</strong></div><span style="font-size:1.5em;color:#ccc">≡</span>`;
        container.appendChild(div);
        addDragEvents(div, container);
    });
}

// --- 4. COMPROBAR ---
async function checkOrder() {
    attempts++;
    const container = document.getElementById('cards-container');
    const playerIds = Array.from(container.children).map(c => c.dataset.id);
    
    const correctIds = [...currentEvents]
        .sort((a, b) => (a.year - b.year) || (new Date(a.exactDate || 0) - new Date(b.exactDate || 0)))
        .map(e => e._id);
    
    const isWin = JSON.stringify(playerIds) === JSON.stringify(correctIds);

    if (isWin) {
        if (isDuel) {
            socket.emit('multiduel-finished', { name: currentPlayer, score: currentEvents.length });
            Swal.fire('¡GANASTE! 🏆', '', 'success');
            showScreen('menu-screen');
        } else {
            if (attempts === 1) {
                Swal.fire('¡PERFECTO! 🎉', 'Puntos sumados', 'success');
                await saveScore(currentEvents.length);
            } else {
                Swal.fire('Correcto', 'Pero sin puntos (intentos extra)', 'info');
            }
            showScreen('menu-screen');
        }
    } else {
        if (attempts === 1 && !isDuel) await saveScore(-1);
        Swal.fire('Incorrecto', 'Sigue intentándolo', 'error');
    }
}

async function saveScore(points) {
    await fetch('/api/score', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ playerName: currentPlayer, points, type: 'solo' })
    });
}

// --- 5. GUARDAR / EDITAR EVENTOS ---
function resetEventForm() {
    document.getElementById('form-title').textContent = 'Nuevo Recuerdo';
    document.getElementById('evt-id').value = '';
    document.getElementById('evt-title').value = '';
    document.getElementById('evt-year').value = '';
    document.getElementById('evt-date').value = '';
    document.getElementById('evt-photo').value = '';
    if(document.getElementById('evt-difficulty')) document.getElementById('evt-difficulty').value = 'normal';
}

async function uploadEvent() {
    const id = document.getElementById('evt-id').value;
    const title = document.getElementById('evt-title').value;
    const year = document.getElementById('evt-year').value;
    const date = document.getElementById('evt-date').value;
    const photo = document.getElementById('evt-photo').files[0];
    const diffElement = document.getElementById('evt-difficulty');
    const difficulty = diffElement ? diffElement.value : 'normal';

    if (!title || !year) return Swal.fire('Faltan datos', 'Pon título y año', 'warning');

    const formData = new FormData();
    formData.append('title', title);
    formData.append('year', year);
    formData.append('addedBy', currentPlayer || 'Admin');
    formData.append('difficulty', difficulty);
    
    if (date) {
        const parts = date.split('/');
        if(parts.length === 3) formData.append('exactDate', `${parts[2]}-${parts[1]}-${parts[0]}`);
    }
    if (photo) formData.append('image', photo);

    // CORRECCIÓN PLURAL (/api/events)
    const url = id ? `/api/events/${id}` : '/api/events'; 
    const method = id ? 'PUT' : 'POST';

    Swal.fire({title: 'Guardando...', didOpen: () => Swal.showLoading()});

    try {
        const res = await fetch(url, { method: method, body: formData });
        const data = await res.json();
        
        if (data.success || data._id) {
            Swal.fire('¡Guardado!', '', 'success');
            if(id) showAdmin(); 
            else showScreen('menu-screen');
        } else {
            throw new Error(data.error);
        }
    } catch (e) {
        console.error(e);
        Swal.fire('Error', 'No se pudo guardar', 'error');
    }
}

// --- 6. ADMIN ---
async function showAdmin() {
    showScreen('admin-screen');
    const res = await fetch('/api/events'); // Corregido: sin /all
    const events = await res.json();
    const list = document.getElementById('admin-events-list');
    list.innerHTML = '';

    events.forEach(evt => {
        const div = document.createElement('div');
        div.className = 'admin-item';
        const star = evt.difficulty === 'easy' ? '⭐' : '';
        // Truco para evitar problemas con comillas en el JSON
        const evtString = JSON.stringify(evt).replace(/'/g, "&#39;");
        
        div.innerHTML = `
            <span>${evt.year} - ${evt.title} ${star}</span>
            <div class="admin-actions">
                <button class="btn-yellow" onclick='editEvent(${evtString})'>✏️</button>
                <button class="btn-red" onclick="deleteEvent('${evt._id}')">🗑️</button>
            </div>
        `;
        list.appendChild(div);
    });
}

function editEvent(evt) {
    showScreen('add-event-screen');
    document.getElementById('form-title').textContent = 'Editar Recuerdo';
    document.getElementById('evt-id').value = evt._id;
    document.getElementById('evt-title').value = evt.title;
    document.getElementById('evt-year').value = evt.year;
    if(document.getElementById('evt-difficulty')) document.getElementById('evt-difficulty').value = evt.difficulty || 'normal';
    
    if (evt.exactDate) {
        const d = new Date(evt.exactDate);
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        document.getElementById('evt-date').value = `${day}/${month}/${d.getFullYear()}`;
    }
}

async function deleteEvent(id) {
    const confirm = await Swal.fire({ title: '¿Borrar?', icon: 'warning', showCancelButton: true });
    if (confirm.isConfirmed) {
        await fetch(`/api/events/${id}`, { method: 'DELETE' });
        showAdmin(); 
    }
}

async function resetWeekly() {
    if ((await Swal.fire({ title: '¿Reiniciar SEMANAL?', showCancelButton: true })).isConfirmed) {
        await fetch('/api/admin/reset-weekly', { method: 'POST' });
        Swal.fire('Hecho', '', 'success');
    }
}
async function resetTotal() {
    if ((await Swal.fire({ title: '¿Reiniciar HISTÓRICO?', icon: 'warning', showCancelButton: true })).isConfirmed) {
        await fetch('/api/admin/reset-total', { method: 'POST' });
        Swal.fire('Hecho', '', 'success');
    }
}

// --- 7. UTILIDADES ---
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    const sc = document.getElementById(screenId);
    if(sc) sc.classList.remove('hidden');
}

function addDragEvents(item, container) {
    item.addEventListener('dragstart', () => item.classList.add('dragging'));
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
    container.addEventListener('dragover', e => {
        e.preventDefault();
        const after = getDragAfterElement(container, e.clientY);
        const drg = document.querySelector('.dragging');
        if (!after) container.appendChild(drg);
        else container.insertBefore(drg, after);
    });
}

function getDragAfterElement(container, y) {
    const els = [...container.querySelectorAll('.event-card:not(.dragging)')];
    return els.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) return { offset: offset, element: child };
        else return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}