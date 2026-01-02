const socket = io();

// --- CONFIGURACIÓN ---
const GAME_PASSWORD = 'pablo2101'; // <--- ¡CAMBIA ESTO SI QUIERES!

// VARIABLES GLOBALES
let currentPlayer = null;
let currentEvents = []; 
let currentHofData = null;
let attempts = 0;
let isDuel = false; // Para saber si estamos en modo duelo
let isInLobby = false; // Para controlar la sala de espera

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
    
    // Conectamos el socket con nuestro nombre
    socket.emit('login-user', currentPlayer);
}

// ---------------------------------------------------------
// 2. LÓGICA DEL MULTIJUGADOR (SALA DE DUELOS / LOBBY)
// ---------------------------------------------------------

// Entrar a la sala
function enterDuelLobby() {
    if (!currentPlayer) return;
    showScreen('lobby-screen');
    socket.emit('join-lobby', currentPlayer);
    isInLobby = true;
}

// Salir de la sala
function leaveLobby() {
    socket.emit('leave-lobby');
    isInLobby = false;
    showScreen('menu-screen');
}

// Recibir lista de gente en la sala (Actualizar visualmente)
socket.on('update-lobby', (players) => {
    if (!isInLobby) return;
    
    const list = document.getElementById('lobby-players-list');
    if(list) {
        list.innerHTML = players.map(p => `<div style="margin:5px;">👤 ${p.name}</div>`).join('');
    }
});

// El botón de "¡EMPEZAR PARTIDA!" del lobby llama a esto
function startMultiDuel() {
    const difficulty = document.getElementById('lobby-difficulty').value;
    socket.emit('start-multiduel', difficulty);
}

// EL SERVIDOR DICE: ¡EMPIEZA EL DUELO PARA TODOS!
socket.on('multiduel-start', (events) => {
    isDuel = true;
    attempts = 0;
    currentEvents = events;
    
    // 1. Mostramos pantalla de juego
    renderGame("⚔️ DUELO MULTIJUGADOR");
    
    // 2. Aviso visual
    Swal.fire({
        title: '¡EMPIEZA!',
        text: '¡El primero en acabar gana!',
        timer: 1500,
        showConfirmButton: false
    });
});

// Cuando alguien gana (recibimos el aviso del servidor)
socket.on('player-finished', (data) => {
    if (data.name !== currentPlayer) {
        Swal.fire('¡Duelo finalizado!', `${data.name} ha terminado.`, 'info');
    }
});

// ---------------------------------------------------------
// 3. LÓGICA DEL JUEGO (MODO SOLO Y RENDERIZADO)
// ---------------------------------------------------------

async function setupGame(mode) {
    isDuel = false; // Reset de modo duelo
    
    if (mode === 'solo') {
        // LEEMOS SI EL MODO JUNIOR ESTÁ ACTIVADO
        const isJunior = document.getElementById('mode-junior') ? document.getElementById('mode-junior').checked : false;
        
        const { value: count } = await Swal.fire({
            title: isJunior ? 'Modo Junior 👶' : 'Modo Normal',
            input: 'range',
            inputLabel: '¿Cuántas cartas?',
            inputAttributes: { min: 2, max: 10, step: 1 },
            inputValue: 3
        });
        
        if (count) {
            // Pasamos la dificultad elegida
            startGameSolo(count, isJunior ? 'easy' : 'normal');
        }
    }
}

async function startGameSolo(count, difficulty) {
    Swal.fire({title: 'Barajando...', didOpen: () => Swal.showLoading()});
    attempts = 0;
    try {
        // SOLICITAMOS CON EL FILTRO DE DIFICULTAD
        const res = await fetch(`/api/game?count=${count}&difficulty=${difficulty}`);
        const data = await res.json();
        
        if (data.error) throw new Error(data.error);
        
        currentEvents = data;
        renderGame(difficulty === 'easy' ? "Modo Junior 👶" : "Modo Solitario");
        Swal.close();
    } catch(e) { 
        Swal.fire('Ups', e.message || 'Error al cargar cartas', 'info'); 
    }
}

function renderGame(titleText) {
    const titleEl = document.getElementById('game-mode-title');
    if(titleEl) titleEl.textContent = titleText;
    
    const container = document.getElementById('cards-container');
    container.innerHTML = '';
    showScreen('game-screen');
    
    // Barajamos visualmente
    const shuffled = [...currentEvents].sort(() => Math.random() - 0.5);

    shuffled.forEach(evt => {
        const div = document.createElement('div');
        div.className = 'event-card';
        div.draggable = true;
        div.dataset.id = evt._id;
        
        // Si hay imagen la mostramos
        const imgHtml = evt.imageUrl ? `<img src="${evt.imageUrl}">` : '';
        
        div.innerHTML = `
            <div style="display:flex; align-items:center">
                ${imgHtml} 
                <strong>${evt.title}</strong>
            </div>
            <span style="color:#ccc; font-size:1.2em;">☰</span>
        `;
        container.appendChild(div);
        
        // Añadimos la capacidad de arrastrar
        addDragEvents(div, container);
    });
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
        // Si el año es igual, miramos la fecha exacta, si no hay, da igual el orden
        const dateA = a.exactDate ? new Date(a.exactDate) : 0;
        const dateB = b.exactDate ? new Date(b.exactDate) : 0;
        return dateA - dateB;
    });
    const correctIds = correctOrder.map(e => e._id);
    
    const isWin = JSON.stringify(playerOrderIds) === JSON.stringify(correctIds);

    if (isWin) {
        // --- CASO 1: VICTORIA EN DUELO ---
        if (isDuel) {
             Swal.fire('¡GANASTE! 🏆', 'Has terminado tu línea temporal.', 'success');
             // Avisamos al servidor de que hemos acabado
             socket.emit('multiduel-finished', { name: currentPlayer, score: currentEvents.length });
             showScreen('menu-screen');
        } 
        // --- CASO 2: VICTORIA SOLITARIO ---
        else {
            if (attempts === 1) {
                const points = currentEvents.length;
                Swal.fire('¡PERFECTO! 🎉', `A la primera: Ganas ${points} puntos`, 'success');
                await saveScore(points);
            } else {
                Swal.fire('¡Correcto!', 'Bien ordenado (pero no sumas puntos porque fallaste antes).', 'info');
            }
            showScreen('menu-screen');
        }
    } else {
        // --- CASO 3: FALLO ---
        if (isDuel) {
             Swal.fire('¡Incorrecto!', 'Rápido, inténtalo de nuevo.', 'error');
        } else {
            // Solitario
            if (attempts === 1) {
                const penalty = -1; // Restamos solo 1 punto por fallar, para no ser crueles
                Swal.fire('¡Fallaste! 😞', `Primer intento fallido: Pierdes 1 punto.`, 'error');
                await saveScore(penalty);
            } else {
                Swal.fire('Sigue mal...', 'Revisa las fechas e inténtalo de nuevo.', 'error');
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
    const title = document.getElementById('form-title');
    if(title) title.textContent = 'Nuevo Aconteciento';
    document.getElementById('evt-id').value = ''; 
    document.getElementById('evt-title').value = '';
    document.getElementById('evt-year').value = '';
    document.getElementById('evt-date').value = '';
    document.getElementById('evt-photo').value = '';
    // Resetear el selector si existe
    if(document.getElementById('evt-difficulty')) 
        document.getElementById('evt-difficulty').value = 'normal';
}

async function uploadEvent() {
    const id = document.getElementById('evt-id').value;
    const title = document.getElementById('evt-title').value;
    const year = document.getElementById('evt-year').value;
    const date = document.getElementById('evt-date').value;
    const photo = document.getElementById('evt-photo').files[0];
    
    // CAPTURAR LA DIFICULTAD (MODO JUNIOR)
    const diffElement = document.getElementById('evt-difficulty');
    const difficulty = diffElement ? diffElement.value : 'normal';

    if (!title || !year) return Swal.fire('Faltan datos', 'Pon título y año', 'warning');

    const formData = new FormData();
    formData.append('title', title);
    formData.append('year', year);
    formData.append('addedBy', currentPlayer);
    formData.append('difficulty', difficulty); // <--- ENVIAMOS SI ES EASY O NORMAL
    
    if (date) {
        // Convertir fecha dd/mm/yyyy a yyyy-mm-dd
        const parts = date.split('/');
        if(parts.length === 3) {
            formData.append('exactDate', `${parts[2]}-${parts[1]}-${parts[0]}`);
        }
    }
    if (photo) formData.append('image', photo); // Ojo: en server.js usamos 'image'

    const url = id ? `/api/events/${id}` : '/api/events';
    const method = id ? 'PUT' : 'POST'; // Nota: Si no tienes PUT en server, usa POST o adáptalo

    Swal.fire({title: 'Subiendo...', didOpen: () => Swal.showLoading()});

    try {
        const res = await fetch(url, { method: method, body: formData });
        const data = await res.json();
        
        if (!data.error) {
            Swal.fire('¡Guardado!', '', 'success');
            if(id) showAdmin(); 
            else showScreen('menu-screen');
        } else {
            throw new Error(data.error);
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
    // Asumiendo el orden: Semanal, Histórico
    const btns = document.querySelectorAll('.tab-btn');
    if(btns.length > 0) {
        if(type === 'weekly') btns[0].classList.add('active');
        else if(btns[1]) btns[1].classList.add('active');
    }

    const list = type === 'weekly' ? currentHofData.weekly : currentHofData.total;
    let html = '<ol>';
    if(list) {
        list.forEach(p => {
            const pts = type === 'weekly' ? p.stats.weeklyPoints : p.stats.totalPoints;
            html += `<li><strong>${p.name}</strong>: ${pts} pts</li>`;
        });
    }
    html += '</ol>';
    document.getElementById('hof-list').innerHTML = html;
}

// ADMIN - CARGAR LISTA
async function showAdmin() {
    showScreen('admin-screen');
    const res = await fetch('/api/events'); // Asegúrate que esta ruta coincide con server.js
    const events = await res.json();
    const list = document.getElementById('admin-events-list');
    list.innerHTML = '';

    events.forEach(evt => {
        const div = document.createElement('div');
        div.className = 'admin-item';
        // Icono visual de si es fácil o normal
        const star = evt.difficulty === 'easy' ? '⭐' : '';
        div.innerHTML = `
            <span>${evt.year} - ${evt.title} ${star}</span>
            <div class="admin-actions">
                <button class="btn-yellow" onclick='editEvent(${JSON.stringify(evt).replace(/'/g, "&#39;")})'>✏️</button>
                <button class="btn-red" onclick="deleteEvent('${evt._id}')">🗑️</button>
            </div>
        `;
        list.appendChild(div);
    });
}

// ADMIN - EDITAR (Rellena el formulario con datos existentes)
function editEvent(evt) {
    showScreen('add-event-screen');
    const title = document.getElementById('form-title');
    if(title) title.textContent = 'Editar Recuerdo';
    
    document.getElementById('evt-id').value = evt._id;
    document.getElementById('evt-title').value = evt.title;
    document.getElementById('evt-year').value = evt.year;
    
    // Poner la dificultad correcta
    if(document.getElementById('evt-difficulty')) {
        document.getElementById('evt-difficulty').value = evt.difficulty || 'normal';
    }
    
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
        await fetch(`/api/events/${id}`, { method: 'DELETE' });
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
    const screen = document.getElementById(screenId);
    if(screen) screen.classList.remove('hidden');
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
