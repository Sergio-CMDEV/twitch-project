require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const TwitchStrategy = require('passport-twitch-new').Strategy;
const mysql = require('mysql2/promise');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = 3000;

// Config MySQL
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});
module.exports = pool;

const TROOP_TYPES = [
    'Guerrero',       
    'Arquero',        
    'Lancero',        
    'Caballería',     
    'Elefante',       // Exclusiva de Albion
    'Soldado de élite', // Exclusiva de Arkangel
    'Berserker',      // Exclusiva de Salazar
    'Arquero de élite'// Exclusiva de Helenia
];

const EXCLUSIVE_TROOPS = {
    'Albion': 'Elefante',
    'Arkangel': 'Soldado de élite',
    'Salazar': 'Berserker',
    'Helenia': 'Arquero de élite'
};


// Middleware
app.use(session({
    secret: 'secreto_super_seguro',
    resave: false,
    saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json()); // Esto es importante para que pueda leer JSON

// Passport
passport.use(new TwitchStrategy({
    clientID: process.env.TWITCH_CLIENT_ID,
    clientSecret: process.env.TWITCH_CLIENT_SECRET,
    callbackURL: "http://localhost:3000/auth/twitch/callback",
    scope: "user:read:email"
}, async (accessToken, refreshToken, profile, done) => {
    try {
        const [rows] = await pool.query('SELECT * FROM users WHERE twitch_id = ?', [profile.id]);
        if (rows.length > 0) {
            // Actualiza la imagen de perfil si ha cambiado
            await pool.query('UPDATE users SET profile_image_url = ? WHERE twitch_id = ?', [profile.profile_image_url, profile.id]);
            return done(null, { ...rows[0], profile_image_url: profile.profile_image_url });
        }
        // Nuevo usuario: is_admin por defecto NULL (o 0 por defecto de la tabla), pero nunca se fuerza a 0 si ya existe
        const newUser = {
            twitch_id: profile.id,
            display_name: profile.display_name,
            profile_image_url: profile.profile_image_url,
            role: 'user',
            reino: null,
            coins: 100
            // is_admin NO se pone aquí, lo gestiona la base de datos
        };
        await pool.query('INSERT INTO users SET ?', newUser);
        // Leer el usuario recién creado para obtener is_admin real
        const [created] = await pool.query('SELECT * FROM users WHERE twitch_id = ?', [profile.id]);
        done(null, created[0]);
    } catch (err) {
        done(err, null);
    }
}));

passport.serializeUser((user, done) => done(null, user.twitch_id));
passport.deserializeUser(async (id, done) => {
    const [rows] = await pool.query('SELECT * FROM users WHERE twitch_id = ?', [id]);
    done(null, rows[0]);
});

// Auth Routes
app.get('/auth/twitch', passport.authenticate('twitch'));
app.get('/auth/twitch/callback', passport.authenticate('twitch', {
    failureRedirect: '/login'
}), (req, res) => res.redirect('/'));

app.get('/logout', (req, res) => {
    req.logout(() => res.redirect('/'));
});

// Middleware Roles
function ensureAuth(req, res, next) {
    if (req.isAuthenticated()) return next();
    res.redirect('/login');
}

function ensureAdmin(req, res, next) {
    if (req.user.role === 'admin') return next();
    res.send('Acceso denegado');
}

// tropas API (ahora usando user_legions)
app.get('/api/tropas', ensureAuth, async (req, res) => {
  // Suma la cantidad de todas las legiones del usuario
  const [rows] = await pool.query('SELECT troop_type, quantity FROM user_legions WHERE user_id = ?', [req.user.id]);
  res.json(rows);
});

// Endpoint: Actividad reciente (solo datos reales de la base de datos)
app.get('/api/actividad', ensureAuth, async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const [rows] = await pool.query('SELECT tipo, cantidad, descripcion, fecha FROM user_activity WHERE user_id = ? ORDER BY fecha DESC LIMIT 10', [req.user.id]);
    res.json(rows);
  } catch (e) {
    console.error('Error en /api/actividad:', e);
    res.status(500).json([]);
  }
});

// Endpoint: Estadísticas reales (consulta la base de datos)
app.get('/api/estadisticas', ensureAuth, async (req, res) => {
  try {
    // Suponiendo que tienes las columnas victorias, derrotas, edificios, tropas_perdidas en la tabla users
    const [rows] = await pool.query('SELECT victorias, derrotas, edificios, tropas_perdidas FROM users WHERE id = ?', [req.user.id]);
    if (rows.length > 0) {
      res.json(rows[0]);
    } else {
      res.json({ victorias: 0, derrotas: 0, edificios: 0, tropas_perdidas: 0 });
    }
  } catch (e) {
    res.status(500).json({ victorias: 0, derrotas: 0, edificios: 0, tropas_perdidas: 0 });
  }
});

// Endpoint: Noticias (GET y POST)
app.get('/api/noticias', ensureAuth, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, titulo, resumen, fecha FROM noticias ORDER BY fecha DESC LIMIT 20');
    res.json(rows);
  } catch (e) {
    res.status(500).json([]);
  }
});

app.post('/api/noticias', ensureAuth, async (req, res) => {
  // Solo admin puede añadir noticias
  if (!req.user.is_admin) return res.status(403).json({ error: 'Solo admin puede añadir noticias' });
  const { titulo, resumen } = req.body || {};
  if (!titulo || !resumen) return res.status(400).json({ error: 'Faltan campos' });
  try {
    await pool.query('INSERT INTO noticias (titulo, resumen, fecha) VALUES (?, ?, NOW())', [titulo, resumen]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Error al guardar noticia' });
  }
});

// Endpoint: Eliminar noticia (solo admin)
app.delete('/api/noticias/:id', ensureAuth, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Solo admin puede eliminar noticias' });
  const noticiaId = req.params.id;
  try {
    const [result] = await pool.query('DELETE FROM noticias WHERE id = ?', [noticiaId]);
    if (result.affectedRows > 0) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Noticia no encontrada' });
    }
  } catch (e) {
    res.status(500).json({ error: 'Error al eliminar noticia' });
  }
});

// Endpoint: Estadísticas rápidas para admin
app.get('/api/usuarios-count', ensureAuth, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ count: 0 });
  try {
    const [rows] = await pool.query('SELECT COUNT(*) as count FROM users');
    res.json({ count: rows[0].count });
  } catch (e) {
    res.json({ count: 0 });
  }
});

app.get('/api/reinos-count', ensureAuth, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ count: 0 });
  try {
    const [rows] = await pool.query('SELECT COUNT(DISTINCT reino) as count FROM users WHERE reino IS NOT NULL AND reino != ""');
    res.json({ count: rows[0].count });
  } catch (e) {
    res.json({ count: 0 });
  }
});

app.get('/api/legiones-count', ensureAuth, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ count: 0 });
  try {
    const [rows] = await pool.query('SELECT COUNT(*) as count FROM user_legions');
    res.json({ count: rows[0].count });
  } catch (e) {
    res.json({ count: 0 });
  }
});

// Endpoint: Estado de Twitch (stream online/offline) con formato esperado por el frontend
app.get('/api/twitch_status', async (req, res) => {
  const channel = req.query.channel || 'DearBird';
  try {
    // Obtener token de app
    const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `client_id=${process.env.TWITCH_CLIENT_ID}&client_secret=${process.env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`
    });
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // Consultar estado del stream
    const twitchRes = await fetch(`https://api.twitch.tv/helix/streams?user_login=${channel}`, {
      headers: {
        'Client-ID': process.env.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${accessToken}`
      }
    });
    const streamData = await twitchRes.json();
    const isLive = streamData.data && streamData.data.length > 0;
    let streamTitle = '';
    let gameName = '';
    if (isLive) {
      const stream = streamData.data[0];
      streamTitle = stream.title;
      gameName = stream.game_name;
    }

    // Consultar últimos datos si está offline
    const userRes = await fetch(`https://api.twitch.tv/helix/users?login=${channel}`, {
      headers: {
        'Client-ID': process.env.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${accessToken}`
      }
    });
    const userData = await userRes.json();
    const broadcasterId = userData.data?.[0]?.id;

    res.json({
      isLive,
      streamTitle,
      gameName,
      lastStreamTitle: streamTitle, // Twitch no ofrece histórico real sin API extra, usamos este como placeholder
      lastGameName: gameName,
      broadcasterId
    });
  } catch (e) {
    console.error('Error en /api/twitch_status:', e);
    res.status(500).json({ error: 'No se pudo consultar Twitch' });
  }
});

// Endpoint: Clips recientes de Twitch con formato esperado por el frontend
app.get('/api/twitch_clips', async (req, res) => {
  const broadcaster = req.query.broadcaster_id || 'DearBird';
  try {
    const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `client_id=${process.env.TWITCH_CLIENT_ID}&client_secret=${process.env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`
    });
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    const userRes = await fetch(`https://api.twitch.tv/helix/users?login=${broadcaster}`, {
      headers: {
        'Client-ID': process.env.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${accessToken}`
      }
    });
    const userData = await userRes.json();
    const userId = userData.data?.[0]?.id;
    if (!userId) return res.status(404).json({ error: 'Usuario no encontrado' });

    const clipsRes = await fetch(`https://api.twitch.tv/helix/clips?broadcaster_id=${userId}&first=10`, {
      headers: {
        'Client-ID': process.env.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${accessToken}`
      }
    });
    const clipsData = await clipsRes.json();

    res.json({
      clips: clipsData.data.map(clip => ({
        embed_url: clip.embed_url
      }))
    });
  } catch (e) {
    console.error('Error en /api/twitch_clips:', e);
    res.status(500).json({ error: 'No se pudo obtener clips de Twitch' });
  }
});

// Endpoint: Listar usuarios with paginación y búsqueda (solo admin)
app.get('/api/usuarios', ensureAuth, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Solo admin puede ver usuarios' });
  const pagina = parseInt(req.query.pagina) || 1;
  const busqueda = (req.query.busqueda || '').trim();
  const porPagina = 10;
  const offset = (pagina - 1) * porPagina;

  let where = '';
  let params = [];
  if (busqueda) {
    where = 'WHERE display_name LIKE ? OR id = ?';
    params = [`%${busqueda}%`, busqueda];
  }

  try {
    // Total de usuarios para paginación
    const [countRows] = await pool.query(`SELECT COUNT(*) as total FROM users ${where}`, params);
    const total = countRows[0].total;
    const totalPaginas = Math.max(1, Math.ceil(total / porPagina));

    // Usuarios de la página actual
    const [usuarios] = await pool.query(
      `SELECT id, display_name AS nombre, reino, profile_image_url FROM users ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, porPagina, offset]
    );
    res.json({ usuarios, totalPaginas });
  } catch (e) {
    console.error('Error en /api/usuarios:', e);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

// Endpoint: Editar usuario (solo admin)
app.put('/api/usuarios/:id', ensureAuth, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Solo admin puede editar usuarios' });
  const userId = req.params.id;
  const { reino } = req.body;
  if (!reino) return res.status(400).json({ error: 'Falta el campo reino' });
  try {
    await pool.query('UPDATE users SET reino = ? WHERE id = ?', [reino, userId]);
    res.json({ success: true });
  } catch (e) {
    console.error('Error al editar usuario:', e);
    res.status(500).json({ error: 'Error al editar usuario' });
  }
});

// Endpoint: Eliminar usuario (solo admin)
app.delete('/api/usuarios/:id', ensureAuth, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Solo admin puede eliminar usuarios' });
  const userId = req.params.id;
  try {
    const [result] = await pool.query('DELETE FROM users WHERE id = ?', [userId]);
    if (result.affectedRows > 0) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Usuario no encontrado' });
    }
  } catch (e) {
    console.error('Error al eliminar usuario:', e);
    res.status(500).json({ error: 'Error al eliminar usuario' });
  }
});

// Rutas
app.get('/', ensureAuth, (req, res) => {
    if (!req.user.reino) return res.redirect('/choose-reino');
    res.sendFile(path.join(__dirname, 'public/main.html'));
});

app.get('/choose-reino', ensureAuth, (req, res) => {
    if (req.user.reino) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'public/choose-reino.html'));
});

// Asegúrate de que tu tabla users tiene is_admin (TINYINT(1))
app.get('/admin', ensureAuth, (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).send('Acceso denegado');
  }
  res.sendFile(path.join(__dirname, 'public/admin.html'));
});

app.get('/mapa', ensureAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public/mapa.html'));
});

app.post('/set-reino', ensureAuth, async (req, res) => {
    const reinoElegido = req.body.reino;
    const usuarioId = req.user.twitch_id;

    try {
        // Actualiza el reino del usuario en la base de datos
        await pool.query('UPDATE users SET reino = ? WHERE twitch_id = ?', [reinoElegido, usuarioId]);

        // Actualiza la sesión del usuario
        req.user.reino = reinoElegido;

        res.json({ success: true });
    } catch (error) {
        console.error('Error al establecer reino:', error);
        res.status(500).json({ success: false, message: 'Error del servidor' });
    }
});

app.get('/api/usuario', ensureAuth, (req, res) => {
    res.json({
        id: req.user.id,
        twitch_id: req.user.twitch_id,
        display_name: req.user.display_name,
        profile_image_url: req.user.profile_image_url,
        reino: req.user.reino,
        is_admin: req.user.is_admin,
        role: req.user.role,
        coins: req.user.coins
    });
});

app.listen(PORT, () => console.log(`Servidor en http://localhost:${PORT}`));
