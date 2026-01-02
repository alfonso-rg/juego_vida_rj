const socket = io();

// --- CONFIGURACIÓN ---
const GAME_PASSWORD = 'pablo2101'; // <--- ¡CAMBIA ESTO SI QUIERES OTRA CONTRASEÑA!

// VARIABLES GLOBALES
let currentPlayer = null;
let currentEvents = []; 
let currentHofData = null;
let attempts = 0;
let isDuel = false; // Para saber si estamos en modo duelo
let currentDuelId = null;

// AL CARGAR LA PÁGINA
document.addEventListener('DOMContentLoaded', () => { 
    loadPlayers(); 
});

// ---------------------------------------------------------
// 1. GESTIÓN DE USUARIOS (LOGIN)
// ---------------------------------------------------------

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

    // AQUÍ ESTÁ LA COMPROBACIÓN DE CONTRASEÑA
    if (!name) {
        Swal.fire('Error', 'Debes seleccionar un nombre', 'warning');
        return;
    }
    
    if (pass !== GAME_PASSWORD) {
        Swal.fire('Error', 'Contraseña incorrecta', 'error');
        return;
    }

    // Si todo va bien...
    currentPlayer = name;
    document.getElementById('welcome-msg').textContent = `Hola, ${currentPlayer}`;
    showScreen('menu-screen');
}

// ---------------------------------------------------------
// 2. LÓGICA DEL MULTIJUGADOR (SOCKETS)
// ---------------------------------------------------------

// ACTUALIZAR LISTA DE PARTIDAS (LOBBY)
socket.on('lobby_update', (games) => {
    // Solo actualizamos si el usuario está mirando la pantalla del lobby
    if (document.getElementById('duel-lobby-screen').classList.contains('hidden')) return;

    const list = document.getElementById('lobbies-list');
    list.innerHTML = '';
    
    // Filtramos solo las partidas que están esperando (waiting)
    const availableGames = Object.values(games).filter(g => g.state === 'waiting');

    if (availableGames.length === 0) {
        list.innerHTML = '<p style="color:#777; font-style:italic;">No hay partidas creadas. ¡Crea una tú!</p>';
        return;
    }

    availableGames.forEach(game => {
        const div = document.createElement('div');
        div.className = 'admin-item'; 
        
        // Botón para unirse
        // Si soy yo mismo el que creó la partida, no me muestro el botón de unirme
        let actionBtn = '';
        if (game.host !== currentPlayer) {
            actionBtn = `<button class="btn-green small" onclick="joinDuel('${game.id}')">Unirse</button>`;
        } else {
            actionBtn = `<span style="color:#f1c40f; font-size:0.8em;">(Tu partida)</span>`;
        }

        div.innerHTML = `
            <span><strong>${game.host}</strong> busca rival (${game.rounds} cartas)</span>
            ${actionBtn}
        `;
        list.appendChild(div);
    });
});

// CUANDO CREO UNA PARTIDA
socket.on('game_created', ({ gameId }) => {
    currentDuelId = gameId;
    showScreen('duel-wait-screen'); // Pantalla de espera (relojito)
});

// CUANDO EMPIEZA EL JUEGO (Para los dos jugadores a la vez)
socket.on('game_start', ({ events, opponent }) => {
    isDuel = true;
    currentEvents = events;
    attempts = 0;
    
    // Renderizamos el tablero
    renderGame(`⚔️ Duelo contra ${opponent}`);
});

// CUANDO ALGUIEN GANA EL DUELO
socket.on('duel_result', ({ winner }) => {
    if (winner === currentPlayer) {
        Swal.fire({
            title: '¡GANASTE! 🏆',
            text: 'Has sido el más rápido del oeste.',
            icon: 'success',
            confirmButtonText: 'Genial'
        });
    } else {
        Swal.fire({
            title: 'Perdiste 🐢',
            text: `${winner} ha terminado antes que tú.`,
            icon: 'error',
            confirmButtonText: 'Revancha'
        });
    }
    showScreen('menu-screen');
});

// FUNCIONES PARA LOS BOTONES DEL LOBBY
function enterDuelLobby() {
    showScreen('duel-lobby-screen');
    socket.emit('enter_lobby'); // Pide la lista actualizada al servidor
}

function createDuel() {
    const rounds = document.getElementById('duel-rounds').value;
    socket.emit('create_game', { playerName: currentPlayer, rounds: parseInt(rounds) });
}

function joinDuel(gameId) {
    currentDuelId = gameId;
    socket.emit('join_game', { gameId, playerName: currentPlayer });
}


// ---------------------------------------------------------
// 3. LÓGICA DEL JUEGO (RENDERIZADO Y ARRASTRAR)
// ---------------------------------------------------------

async function setupGame(mode) {
    isDuel = false; // Importante: no es duelo
    if (mode === 'solo') {
        const { value: count } = await Swal.fire({
            title: '¿Cuántos eventos?',
            input: 'range',
            inputLabel: 'Elige dificultad',
            inputAttributes: { min: 2, max: 5, step: 1 },
            inputValue: 3
        });
        if (count) {
            startGameSolo(count);
        }
    }
}

async function startGameSolo(count) {
    Swal.fire({title: 'Barajando...', didOpen: () => Swal.showLoading()});
    attempts = 0;
    try {
        const res = await fetch(`/api/game?count=${count}`);
        if (!res.ok) throw new Error('Error');
        currentEvents = await res.json();
        renderGame("Modo Solitario");
        Swal.close();
    } catch(e) { 
        Swal.fire('Ups', 'No hay suficientes eventos en la base de datos.', 'info'); 
    }
}

function renderGame(titleText) {
    document.getElementById('game-mode-title').textContent = titleText;
    const container = document.getElementById('cards-container');
    container.innerHTML = '';
    
    // Barajamos visualmente
    const shuffled = [...currentEvents].sort(() => Math.random() - 0.5);

    shuffled.forEach(evt => {
        const div = document.createElement('div');
        div.className = 'event-card';
        div.draggable = true;
        div.dataset.id = evt._id;
        
        const imgHtml = evt.imageUrl ? `<img src="${evt.imageUrl}">` : '';
        div.innerHTML = `
            <div style="display:flex; align-items:center">
                ${imgHtml} 
                <strong>${evt.title}</strong>
            </div>
            <span>:::</span>
        `;
        container.appendChild(div);
        
        // Añadimos la capacidad de arrastrar
        addDragEvents(div, container);
    });

    showScreen('game-screen');
}

// ---------------------------------------------------------
// 4. COMPROBAR RESULTADO (EL CEREBRO DEL JUEGO)
// ---------------------------------------------------------

async function checkOrder() {
    attempts++;
    const container = document.getElementById('cards-container');
    const playerOrderIds = Array.from(container.children).map(c => c.dataset.id);
    
    // Calculamos el orden correcto (Año -> Fecha exacta)
    const correctOrder = [...currentEvents].sort((a, b) => {
        if (a.year !== b.year) return a.year - b.year;
        return new Date(a.exactDate) - new Date(b.exactDate);
    });
    const correctIds = correctOrder.map(e => e._id);
    
    const isWin = JSON.stringify(playerOrderIds) === JSON.stringify(correctIds);

    if (isWin) {
        // --- CASO 1: VICTORIA EN DUELO ---
        if (isDuel) {
            socket.emit('duel_win', { gameId: currentDuelId, winnerName: currentPlayer });
        } 
        // --- CASO 2: VICTORIA SOLITARIO ---
        else {
            if (attempts === 1) {
                const points = currentEvents.length;
                Swal.fire('¡PERFECTO! 🎉', `A la primera: Ganas ${points} puntos`, 'success');
                await saveScore(points);
            } else {
                Swal.fire('¡Correcto!', 'Has ordenado bien la historia, pero no sumas puntos (no fue al primer intento).', 'info');
            }
            showScreen('menu-screen');
        }
    } else {
        // --- CASO 3: FALLO ---
        if (isDuel) {
             Swal.fire('¡Incorrecto!', 'Rápido, inténtalo de nuevo antes que tu rival.', 'error');
        } else {
            // Solitario
            if (attempts === 1) {
                const penalty = -(currentEvents.length - 1);
                Swal.fire('¡Fallaste! 😞', `Primer intento fallido: Pierdes ${Math.abs(penalty)} puntos.`, 'error');
                await saveScore(penalty);
            } else {
                Swal.fire('Sigue mal...', 'Revisa las fechas.', 'error');
            }
        }
    }
}

async function saveScore(points) {
    await fetch('/api/score', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ playerName: currentPlayer, points, type: 'solo' })
    });
}

// ---------------------------------------------------------
// 5. GESTIÓN DE EVENTOS (SUBIR FOTOS)
// ---------------------------------------------------------

function resetEventForm() {
    document.getElementById('form-title').textContent = 'Nuevo Aconteciento';
    document.getElementById('evt-id').value = ''; 
    document.getElementById('evt-title').value = '';
    document.getElementById('evt-year').value = '';
    document.getElementById('evt-date').value = '';
    document.getElementById('evt-photo').value = '';
}

async function uploadEvent() {
    const id = document.getElementById('evt-id').value;
    const title = document.getElementById('evt-title').value;
    const year = document.getElementById('evt-year').value;
    const date = document.getElementById('evt-date').value;
    const photo = document.getElementById('evt-photo').files[0];

    if (!title || !year) return Swal.fire('Faltan datos', 'Pon título y año', 'warning');

    const formData = new FormData();
    formData.append('title', title);
    formData.append('year', year);
    formData.append('addedBy', currentPlayer);
    
    if (date) {
        const [d, m, y] = date.split('/');
        formData.append('exactDate', `${y}-${m}-${d}`);
    }
    if (photo) formData.append('photo', photo);

    const url = id ? `/api/event/${id}` : '/api/event';
    const method = id ? 'PUT' : 'POST';

    Swal.fire({title: 'Subiendo...', didOpen: () => Swal.showLoading()});

    try {
        const res = await fetch(url, { method: method, body: formData });
        const data = await res.json();
        if (data.success) {
            Swal.fire('¡Guardado!', '', 'success');
            if(id) showAdmin(); 
            else showScreen('menu-screen');
        }
    } catch (e) {
        Swal.fire('Error', 'No se pudo guardar', 'error');
    }
}

// ---------------------------------------------------------
// 6. RANKINGS Y ADMIN
// ---------------------------------------------------------

async function showHallOfFame() {
    const res = await fetch('/api/hof');
    currentHofData = await res.json();
    showScreen('hof-screen');
    switchTab('weekly'); 
}

function switchTab(type) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const btns = document.querySelectorAll('.tab-btn');
    if(type === 'weekly') btns[0].classList.add('active');
    else btns[1].classList.add('active');

    const list = type === 'weekly' ? currentHofData.weekly : currentHofData.total;
    let html = '<ol>';
    list.forEach(p => {
        const pts = type === 'weekly' ? p.stats.weeklyPoints : p.stats.totalPoints;
        html += `<li><strong>${p.name}</strong>: ${pts} pts</li>`;
    });
    html += '</ol>';
    document.getElementById('hof-list').innerHTML = html;
}

// ADMIN - CARGAR LISTA
async function showAdmin() {
    showScreen('admin-screen');
    const res = await fetch('/api/events/all');
    const events = await res.json();
    const list = document.getElementById('admin-events-list');
    list.innerHTML = '';

    events.forEach(evt => {
        const div = document.createElement('div');
        div.className = 'admin-item';
        div.innerHTML = `
            <span>${evt.year} - ${evt.title}</span>
            <div class="admin-actions">
                <button class="btn-yellow" onclick='editEvent(${JSON.stringify(evt)})'>✏️</button>
                <button class="btn-red" onclick="deleteEvent('${evt._id}')">🗑️</button>
            </div>
        `;
        list.appendChild(div);
    });
}

// ADMIN - EDITAR
function editEvent(evt) {
    showScreen('add-event-screen');
    document.getElementById('form-title').textContent = 'Editar Recuerdo';
    document.getElementById('evt-id').value = evt._id;
    document.getElementById('evt-title').value = evt.title;
    document.getElementById('evt-year').value = evt.year;
    
    if (evt.exactDate) {
        const d = new Date(evt.exactDate);
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        document.getElementById('evt-date').value = `${day}/${month}/${d.getFullYear()}`;
    }
}

// ADMIN - BORRAR Y RESETEAR
async function deleteEvent(id) {
    const confirm = await Swal.fire({ title: '¿Borrar?', icon: 'warning', showCancelButton: true });
    if (confirm.isConfirmed) {
        await fetch(`/api/event/${id}`, { method: 'DELETE' });
        showAdmin(); // Recargar lista
    }
}

async function resetWeekly() {
    const confirm = await Swal.fire({ title: '¿Reiniciar SEMANAL?', showCancelButton: true });
    if (confirm.isConfirmed) {
        await fetch('/api/admin/reset-weekly', { method: 'POST' });
        Swal.fire('Reiniciado', '', 'success');
    }
}

async function resetTotal() {
    const confirm = await Swal.fire({ title: '¿Reiniciar HISTÓRICO?', text: 'Se borrarán todos los puntos', icon: 'warning', showCancelButton: true });
    if (confirm.isConfirmed) {
        await fetch('/api/admin/reset-total', { method: 'POST' });
        Swal.fire('Histórico a cero', '', 'success');
    }
}

// ---------------------------------------------------------
// 7. UTILIDADES (Navegación y Drag&Drop)
// ---------------------------------------------------------

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(screenId).classList.remove('hidden');
}

// Drag & Drop
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
    const draggableElements = [...container.querySelectorAll('.event-card:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) return { offset: offset, element: child };
        else return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}