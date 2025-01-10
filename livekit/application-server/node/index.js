import "dotenv/config";
import express from "express";
import cors from "cors";
import { AccessToken, WebhookReceiver } from "livekit-server-sdk";
import mongoose from "mongoose";
import path from "path";
import fs from "fs";
import bcrypt from "bcrypt";

const SERVER_PORT = process.env.SERVER_PORT || 6080;
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || "devkey";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || "secret";

const app = express();

// Inicialización de contraseña de administrador
let adminPassword;
async function initializeAdminPassword() {
  adminPassword = await bcrypt.hash('1234', 10); // Contraseña inicial cifrada
}
initializeAdminPassword();

const mongoURL = process.env.MONGO_URL || 'mongodb://localhost:27017';

const usersDB = mongoose.createConnection(`${mongoURL}/usersDB?retryWrites=true&w=majority`, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const alertsDB = mongoose.createConnection(`${mongoURL}/alertsDB?retryWrites=true&w=majority`, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Esquemas y modelos
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  rol: { type: String, required: true }, // administrador o basico
});
const User = usersDB.model('User', userSchema);

const alertSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  event: { type: String, required: true },
});
const Alert = alertsDB.model('Alert', alertSchema);


app.use(cors());
app.use(express.json());
app.use(express.raw({ type: "application/webhook+json" }));

app.post("/token", async (req, res) => {
  const roomName = req.body.roomName;
  const participantName = req.body.participantName;

  if (!roomName || !participantName) {
    res.status(400).json({ errorMessage: "roomName and participantName are required" });
    return;
  }

  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: participantName,
  });
  at.addGrant({ roomJoin: true, room: roomName });
  const token = await at.toJwt();
  res.json({ token });
});

const webhookReceiver = new WebhookReceiver(
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET
);

app.post("/livekit/webhook", async (req, res) => {
  try {
    const event = await webhookReceiver.receive(
      req.body,
      req.get("Authorization")
    );
    console.log(event);
  } catch (error) {
    console.error("Error validating webhook event", error);
  }
  res.status(200).send();
});

// Autenticación de usuarios
const authenticateUser = async (req, res, next) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ username });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }
    req.user = user;
    next();
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
};

// Cambiar contraseña de administrador
app.post('/change-admin-password', express.json(), async (req, res) => {
  const { username, password, newAdminPassword } = req.body;

  try {
    // Busca al usuario
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Verifica que el usuario es administrador
    if (user.rol !== 'administrador') {
      return res.status(403).json({ error: 'Acceso denegado: solo los administradores pueden cambiar la contraseña de administrador' });
    }

    // Compara la contraseña actual con la almacenada
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    // Actualiza la contraseña de administrador (cifrada)
    adminPassword = await bcrypt.hash(newAdminPassword, 10);

    res.status(200).json({ message: 'Contraseña de administrador actualizada exitosamente' });
  } catch (error) {
    console.error('Error al cambiar contraseña de administrador:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});


// Añadir alerta al historial
async function addToHistory(event) {
  try {
    const alert = new Alert({ event });
    await alert.save();
    console.log('Alerta añadida al historial:', alert);
  } catch (error) {
    console.error('Error al guardar la alerta:', error);
  }
}

// Obtener historial
app.get('/history', async (req, res) => {
  try {
    const history = await Alert.find().sort({ timestamp: -1 });
    res.json(history);
  } catch (error) {
    console.error('Error al obtener el historial:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Registro de usuario
app.post('/register', express.json(), async (req, res) => {
  const { username, password, adminKey, rol } = req.body;

  if (!rol || !['administrador', 'basico'].includes(rol)) {
    return res.status(400).json({ error: 'El rol es obligatorio y debe ser "administrador" o "basico"' });
  }

  try {
    // Verifica si la clave de administrador es correcta usando bcrypt.compare
    const isAdminKeyValid = await bcrypt.compare(adminKey, adminPassword);
    if (!isAdminKeyValid) {
      return res.status(403).json({ error: 'Clave de administrador incorrecta' });
    }

    // Verifica si el usuario ya existe
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: 'El nombre de usuario ya está en uso' });
    }

    // Cifra la contraseña del usuario
    const hashedPassword = await bcrypt.hash(password, 10);

    // Crea un nuevo usuario
    const newUser = new User({ username, password: hashedPassword ,rol});
    await newUser.save();

    res.status(201).json({ message: 'Usuario registrado exitosamente' });
  } catch (error) {
    console.error('Error al registrar usuario:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});


// Login
app.post('/login', express.json(), async (req, res) => {
  const { username, password } = req.body;

  try {
    // Busca al usuario por nombre de usuario
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    // Compara la contraseña proporcionada con la almacenada
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    // Responde con éxito
    res.status(200).json({ message: 'Inicio de sesión exitoso', rol: user.rol });
  } catch (error) {
    console.error('Error al iniciar sesión:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});


// Ruta para registrar manualmente una alerta
app.post('/add-alert', express.json(), async (req, res) => {
  const { event } = req.body;

  if (!event) {
    return res.status(400).json({ error: 'El campo "event" es obligatorio' });
  }

  try {
    const alert = new Alert({ event });
    await alert.save();
    res.status(201).json({ message: 'Alerta registrada exitosamente', alert });
  } catch (error) {
    console.error('Error al guardar alerta:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/mandar-audio', (req, res) => {
  const audioPath = path.join(__dirname, './audios/audio_stop_perro.mp3');

  // Leer el archivo de audio
  fs.readFile(audioPath, (err, audioData) => {
    if (err) {
      console.error('Error al leer el archivo de audio:', err);
      return res.status(500).json({ error: 'Error al cargar el audio' });
    }

    // Enviar el archivo de audio como respuesta
    res.setHeader('Content-Type', 'audio/webm');
    res.send(audioData);
    console.log('Audio preestablecido enviado');
  });
});


app.listen(SERVER_PORT, () => {
  console.log("Server started on port:", SERVER_PORT);
});


