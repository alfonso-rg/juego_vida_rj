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
// Nota: en Render/Linux es mejor usar path, pero si te funciona así en local lo dejamos
// Si en Render falla, cambia 'public' por: require('path').join(__dirname, 'public')
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
        sequencesSolved: { type: Map, of: Number, default: {} } // Para estadísticas detalladas
    }
});

const EventSchema = new mongoose.Schema({
    title: { type: String, required: true },
    year: { type: Number, required: true },
    exactDate: { type: Date }, // Opcional, para desempates
    imageUrl: { type: String },
    addedBy: { type: String },
    difficulty: { type: String, default: 'normal' } // <--- NUEVO: Aquí guardamos si es fácil o normal
});

const Player = mongoose.model('Player', PlayerSchema);
const Event = mongoose.model('Event', EventSchema);

// --- RUTAS API ---

// 1. Obtener lista de jugadores
app.get('/api/players', async (req, res) => {
    const players = await Player.find({}, 'name');
    res.json(players);
});

// 2. Obtener todos los eventos (Para el admin)
app.get('/api/events', async (req, res) => {
    const events = await Event.find().sort({ year: 1 });
    res.json(events);
});

// 3. Crear nuevo evento (Subida de foto incluida)
app.post('/api/events', upload.single('image'), async (req, res) => {
    try {
        const { title, year, exactDate, difficulty } = req.body; // <--- AÑADIDO difficulty
        
        const newEvent = new Event({ 
            title, 
            year, 
            exactDate: exactDate || null,
            imageUrl: req.file ? req.file.path : null, // Si no hay foto, null
            difficulty: difficulty || 'normal' // <--- AÑADIDO: Si no envían nada, es normal
        });
        
        await newEvent.save();
        console.log(`📸 Nuevo evento guardado: ${title} (${difficulty})`);
        res.json(newEvent);
    } catch (error) {
        console.error("Error al subir:", error);
        res.status(500).json({ error: "Error al guardar el evento" });
    }
});

// 4. Borrar evento
app.delete('/api/events/:id', async (req, res) => {
    try {
        await Event.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: "No se pudo borrar" });
    }
});

// 5. OBTENER CARTAS PARA JUGAR (Lógica del Juego)
app.get('/api/game', async (req, res) => {
    try {
        const count = parseInt(req.query.count) || 5;
        const difficulty = req.query.difficulty; // <--- LEEMOS SI ES MODO EASY
        
        // Filtro: Si piden 'easy', solo buscamos easy. Si no, buscamos todo.
        let matchStage = {};
        if (difficulty === 'easy') {
            matchStage = { difficulty: 'easy' };
        }

        // Usamos aggregate para sacar elementos aleatorios
        const selection = await Event.aggregate([
            { $match: matchStage }, // <--- APLICAMOS EL FILTRO
            { $sample: { size: count } }
        ]);

        // Verificamos si hay suficientes cartas
        if (selection.length < count) {
            return res.status(400).json({ 
                error: "No hay suficientes eventos para jugar. ¡Añade más!" 
            });
        }
        
        res.json(selection);
    } catch (e) { 
        console.error(e);
        res.status(500).json({ error: "Error obteniendo cartas" }); 
    }
});

// 6. Guardar Puntuación
app.post('/api/score', async (req, res) => {
    const { playerName, points, type } = req.body; 
    
    const update = { 
        $inc: { 
            "stats.totalPoints": points, 
            "stats.weeklyPoints": points 
        } 
    };

    // Si es modo solo, guardamos estadística de racha
    if (type === 'solo') {
        update.$inc[`stats.sequencesSolved.${points}`] = 1; 
    }

    await Player.findOneAndUpdate({ name: playerName }, update);
    res.json({ success: true });
});

// 7. Hall of Fame (Rankings)
app.get('/api/hof', async (req, res) => {
    const total = await Player.find().sort({ "stats.totalPoints": -1 }).limit(10);
    const weekly = await Player.find().sort({ "stats.weeklyPoints": -1 }).limit(10);
    res.json({ total, weekly });
});

// 8. Rutas de Admin (Resetear puntos)
app.post('/api/admin/reset-weekly', async (req, res) => {
    await Player.updateMany({}, { $set: { "stats.weeklyPoints": 0 } });
    res.json({ success: true });
});

app.post('/api/admin/reset-total', async (req, res) => {
    await Player.updateMany({}, { $set: { "stats.totalPoints": 0 } });
    res.json({ success: true });
});

// 9. Inicializar Jugadores (Tu botón secreto)
app.get('/init-players', async (req, res) => {
    const nombres = ["Elena", "Pablo", "Alfonso"]; // <--- Tus nombres aquí
    for (const nombre of nombres) {
        await Player.findOneAndUpdate(
            { name: nombre }, 
            { name: nombre }, 
            { upsert: true }
        );
    }
    res.send("Jugadores creados/verificados.");
});

// --- SOCKET.IO (Chat / Duelos futuros) ---
io.on('connection', (socket) => {
    console.log('Un usuario se conectó');
    socket.on('disconnect', () => {
        console.log('Usuario desconectado');
    });
});

// --- ARRANCAR SERVIDOR ---
const port = process.env.PORT || 3000;
server.listen(port, () => {
    console.log(`🚀 Servidor funcionando en puerto ${port}`);
});
