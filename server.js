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
// Nota: Si en Render te da problemas la ruta, usa: require('path').join(__dirname, 'public')
app.use(express.static('public')); 

// Conexión a Base de Datos
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ Conectado a MongoDB Atlas"))
    .catch(err => console.error("❌ Error MongoDB:", err));

// Configuración de Imágenes (Cloudinary)
cloudinary.config({ 
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME, 
    api_key: process.env.CLOUDINARY_API_KEY, 
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true 
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'familia-rj',
        allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
        transformation: [{ width: 800, crop: "limit" }, { quality: "auto" }, { fetch_format: "auto" }]
    },
});
const upload = multer({ storage: storage });

// --- MODELOS DE DATOS ---

const PlayerSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    stats: {
        totalPoints: { type: Number, default: 0 },
        weeklyPoints: { type: Number, default: 0 },
        sequencesSolved: { type: Map, of: Number, default: {} } 
    }
});

const EventSchema = new mongoose.Schema({
    title: { type: String, required: true },
    year: { type: Number, required: true },
    exactDate: { type: Date }, 
    imageUrl: { type: String },
    addedBy: { type: String },
    difficulty: { type: String, default: 'normal' } 
});

const Player = mongoose.model('Player', PlayerSchema);
const Event = mongoose.model('Event', EventSchema);

// --- RUTAS API ---

// 1. Jugadores
app.get('/api/players', async (req, res) => {
    const players = await Player.find({}, 'name');
    res.json(players);
});

// 2. Todos los eventos (Admin)
app.get('/api/events', async (req, res) => {
    const events = await Event.find().sort({ year: 1 });
    res.json(events);
});

// 3. CREAR evento
app.post('/api/events', upload.single('image'), async (req, res) => {
    try {
        const { title, year, exactDate, difficulty } = req.body;
        
        const newEvent = new Event({ 
            title, 
            year, 
            exactDate: exactDate || null,
            imageUrl: req.file ? req.file.path : null, 
            difficulty: difficulty || 'normal'
        });
        
        await newEvent.save();
        res.json(newEvent);
    } catch (error) {
        console.error("Error al subir:", error);
        res.status(500).json({ error: "Error al guardar" });
    }
});

// 3.5. EDITAR evento (¡ESTA ES LA PARTE QUE TE FALTABA!)
app.put('/api/events/:id', upload.single('image'), async (req, res) => {
    try {
        const { title, year, exactDate, difficulty } = req.body;
        
        const updateData = { 
            title, 
            year, 
            difficulty: difficulty || 'normal' 
        };

        if (exactDate) updateData.exactDate = exactDate;
        
        if (req.file) {
            updateData.imageUrl = req.file.path;
        }

        await Event.findByIdAndUpdate(req.params.id, updateData);
        res.json({ success: true });
    } catch (error) {
        console.error("Error al editar:", error);
        res.status(500).json({ error: "No se pudo editar" });
    }
});

// 4. BORRAR evento
app.delete('/api/events/:id', async (req, res) => {
    try {
        await Event.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: "No se pudo borrar" });
    }
});

// 5. JUEGO (Obtener cartas)
app.get('/api/game', async (req, res) => {
    try {
        const count = parseInt(req.query.count) || 5;
        const difficulty = req.query.difficulty; 
        
        let matchStage = {};
        if (difficulty === 'easy') {
            matchStage = { difficulty: 'easy' };
        }

        const selection = await Event.aggregate([
            { $match: matchStage },
            { $sample: { size: count } }
        ]);

        if (selection.length < count) {
            return res.status(400).json({ error: "Faltan eventos para jugar." });
        }
        
        res.json(selection);
    } catch (e) { res.status(500).json({ error: "Error servidor" }); }
});

// 6. Puntuación
app.post('/api/score', async (req, res) => {
    const { playerName, points, type } = req.body; 
    const update = { 
        $inc: { "stats.totalPoints": points, "stats.weeklyPoints": points } 
    };
    if (type === 'solo') update.$inc[`stats.sequencesSolved.${points}`] = 1; 
    await Player.findOneAndUpdate({ name: playerName }, update);
    res.json({ success: true });
});

// 7. Rankings
app.get('/api/hof', async (req, res) => {
    const total = await Player.find().sort({ "stats.totalPoints": -1 }).limit(10);
    const weekly = await Player.find().sort({ "stats.weeklyPoints": -1 }).limit(10);
    res.json({ total, weekly });
});

// 8. Admin Resets
app.post('/api/admin/reset-weekly', async (req, res) => {
    await Player.updateMany({}, { $set: { "stats.weeklyPoints": 0 } });
    res.json({ success: true });
});
app.post('/api/admin/reset-total', async (req, res) => {
    await Player.updateMany({}, { $set: { "stats.totalPoints": 0 } });
    res.json({ success: true });
});

// 9. Init Players
app.get('/init-players', async (req, res) => {
    const nombres = ["Elena", "Pablo", "Alfonso"];
    for (const nombre of nombres) {
        await Player.findOneAndUpdate({ name: nombre }, { name: nombre }, { upsert: true });
    }
    res.send("Jugadores listos.");
});

// --- SOCKETS ---
io.on('connection', (socket) => {
    socket.on('login-user', (name) => { console.log("User:", name); });
    
    socket.on('join-lobby', (name) => {
        // Aquí podrías añadir lógica real de lobby
        io.emit('update-lobby', [{name}]); // Ejemplo básico
    });
    
    socket.on('start-multiduel', async (difficulty) => {
        // Lógica simplificada para iniciar duelo
        const events = await Event.aggregate([
            { $match: difficulty === 'easy' ? { difficulty: 'easy' } : {} },
            { $sample: { size: 5 } }
        ]);
        io.emit('multiduel-start', events);
    });

    socket.on('multiduel-finished', (data) => {
        io.emit('player-finished', data);
    });
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
    console.log(`🚀 Servidor listo en puerto ${port}`);
});