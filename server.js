require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// --- CONFIGURACIÓN ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ Conectado a MongoDB Atlas"))
    .catch(err => console.error("❌ Error MongoDB:", err));

cloudinary.config({ secure: true });

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'familia-rj',
        allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
        transformation: [{ width: 800, crop: "limit" }, { quality: "auto" }, { fetch_format: "auto" }]
    },
});
const upload = multer({ storage: storage });

// --- MODELOS ---
const PlayerSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    stats: {
        totalPoints: { type: Number, default: 0 },
        weeklyPoints: { type: Number, default: 0 },
        sequencesSolved: { type: Object, default: {2:0, 3:0, 4:0, 5:0} },
        duelWins: { type: Number, default: 0 }
    }
});
const Player = mongoose.model('Player', PlayerSchema);

const EventSchema = new mongoose.Schema({
    title: { type: String, required: true },
    year: { type: Number, required: true },
    exactDate: { type: Date }, 
    imageUrl: { type: String },
    addedBy: { type: String }
});
const Event = mongoose.model('Event', EventSchema);

// --- VARIABLES DE JUEGO MULTIJUGADOR ---
let activeGames = {}; // Guardará las partidas: { gameId: { host: 'Pepe', players: [], state: 'waiting' } }

// --- SOCKET.IO (LÓGICA DEL DUELO) ---
io.on('connection', (socket) => {
    console.log('Nuevo jugador conectado:', socket.id);

    // 1. Al entrar al lobby, le enviamos la lista de partidas
    socket.on('enter_lobby', () => {
        socket.emit('lobby_update', activeGames);
    });

    // 2. Crear una partida nueva
    socket.on('create_game', ({ playerName, rounds }) => {
        const gameId = 'game_' + Math.random().toString(36).substr(2, 9);
        activeGames[gameId] = {
            id: gameId,
            host: playerName,
            rounds: rounds, // Cantidad de cartas (2 a 5)
            players: [{ id: socket.id, name: playerName }],
            state: 'waiting'
        };
        
        socket.join(gameId);
        // Avisar a todos los demás de la nueva partida
        io.emit('lobby_update', activeGames);
        // Avisar al creador que espere
        socket.emit('game_created', { gameId });
    });

    // 3. Unirse a una partida existente
    socket.on('join_game', async ({ gameId, playerName }) => {
        const game = activeGames[gameId];
        if (game && game.state === 'waiting' && game.players.length < 2) {
            game.players.push({ id: socket.id, name: playerName });
            game.state = 'playing';
            socket.join(gameId);
            
            // GENERAR LAS CARTAS (IGUALES PARA LOS DOS)
            try {
                // Reutilizamos la lógica de obtener eventos
                const events = await getGameEvents(game.rounds);
                
                // ¡EMPIEZA EL DUELO! Enviamos las cartas a la sala
                io.to(gameId).emit('game_start', { 
                    events: events, 
                    opponent: game.players[0].name === playerName ? game.players[1].name : game.players[0].name
                });
                
                // Actualizamos lobby (quitamos la partida de la lista pública)
                delete activeGames[gameId]; // Ya no está "waiting"
                io.emit('lobby_update', activeGames);
                
            } catch (e) {
                io.to(gameId).emit('error', 'No hay suficientes eventos para jugar.');
            }
        }
    });

    // 4. Alguien ha ganado (Lo envía el primero que acierta)
    socket.on('duel_win', async ({ gameId, winnerName }) => {
        // Avisamos a la sala quién ganó
        io.to(gameId).emit('duel_result', { winner: winnerName });
        
        // Guardamos el punto en la base de datos
        await Player.findOneAndUpdate(
            { name: winnerName }, 
            { $inc: { "stats.totalPoints": 1, "stats.weeklyPoints": 1, "stats.duelWins": 1 } }
        );
    });
});

// Función auxiliar para obtener eventos (igual que la API)
async function getGameEvents(count) {
    const pool = await Event.aggregate([{ $sample: { size: 40 } }]);
    let selection = [];
    for (let ev of pool) {
        if (selection.length >= count) break;
        let conflict = false;
        for (let existing of selection) {
            if (existing.year === ev.year) {
                if (!existing.exactDate || !ev.exactDate) { conflict = true; break; }
            }
        }
        if (!conflict) selection.push(ev);
    }
    if (selection.length < count) throw new Error("Faltan eventos");
    return selection;
}


// --- RUTAS API (MISMAS QUE ANTES) ---
app.get('/api/players', async (req, res) => {
    try { const players = await Player.find().sort('name'); res.json(players); } 
    catch(e) { res.status(500).json({error: e.message}); }
});

app.post('/api/event', upload.single('photo'), async (req, res) => {
    try {
        const { title, year, exactDate, addedBy } = req.body;
        const newEvent = new Event({
            title, year: parseInt(year),
            exactDate: exactDate ? new Date(exactDate) : null,
            imageUrl: req.file ? req.file.path : null, addedBy
        });
        await newEvent.save();
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: "Error" }); }
});

app.put('/api/event/:id', upload.single('photo'), async (req, res) => {
    try {
        const { title, year, exactDate } = req.body;
        const updateData = { title, year: parseInt(year), exactDate: exactDate ? new Date(exactDate) : null };
        if (req.file) updateData.imageUrl = req.file.path;
        await Event.findByIdAndUpdate(req.params.id, updateData);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Error" }); }
});

app.delete('/api/event/:id', async (req, res) => {
    await Event.findByIdAndDelete(req.params.id);
    res.json({ success: true });
});

app.get('/api/events/all', async (req, res) => {
    const events = await Event.find().sort({ year: 1 });
    res.json(events);
});

app.get('/api/game', async (req, res) => {
    try {
        const count = parseInt(req.query.count) || 5;
        const selection = await getGameEvents(count);
        res.json(selection);
    } catch (e) { res.status(400).json({ error: "Pocos eventos" }); }
});

app.post('/api/score', async (req, res) => {
    const { playerName, points, type } = req.body; 
    const update = { $inc: { "stats.totalPoints": points, "stats.weeklyPoints": points } };
    if (type === 'solo') update.$inc[`stats.sequencesSolved.${points}`] = 1; 
    await Player.findOneAndUpdate({ name: playerName }, update);
    res.json({ success: true });
});

app.get('/api/hof', async (req, res) => {
    const total = await Player.find().sort({ "stats.totalPoints": -1 }).limit(10);
    const weekly = await Player.find().sort({ "stats.weeklyPoints": -1 }).limit(10);
    res.json({ total, weekly });
});

app.post('/api/admin/reset-weekly', async (req, res) => {
    await Player.updateMany({}, { $set: { "stats.weeklyPoints": 0 } });
    res.json({ success: true });
});
app.post('/api/admin/reset-total', async (req, res) => {
    await Player.updateMany({}, { $set: { "stats.totalPoints": 0 } });
    res.json({ success: true });
});

app.get('/init-players', async (req, res) => {
    const nombres = ["Elena", "Pablo", "Alfonso"];
    for (const nombre of nombres) {
        await Player.findOneAndUpdate({ name: nombre }, { name: nombre }, { upsert: true });
    }
    res.send("Jugadores creados/verificados.");
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Servidor listo en http://localhost:${PORT}`));