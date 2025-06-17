require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const TwitchStrategy = require('passport-twitch-new').Strategy;
const mysql = require('mysql2/promise');
const path = require('path');

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

// Middleware
app.use(session({
    secret: 'secreto_super_seguro',
    resave: false,
    saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());
app.use(express.static(path.join(__dirname, 'public')));

// Passport
passport.use(new TwitchStrategy({
    clientID: process.env.TWITCH_CLIENT_ID,
    clientSecret: process.env.TWITCH_CLIENT_SECRET,
    callbackURL: "http://localhost:3000/auth/twitch/callback",
    scope: "user:read:email"
}, async (accessToken, refreshToken, profile, done) => {
    try {
        const [rows] = await pool.query('SELECT * FROM users WHERE twitch_id = ?', [profile.id]);
        if (rows.length > 0) return done(null, rows[0]);
        
        // Nuevo usuario
        const newUser = { twitch_id: profile.id, display_name: profile.display_name, role: 'user', reino: null };
        await pool.query('INSERT INTO users SET ?', newUser);
        done(null, newUser);
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

// Rutas
app.get('/', ensureAuth, (req, res) => {
    if (!req.user.reino) return res.redirect('/choose-reino');
    res.sendFile(path.join(__dirname, 'public/main.html'));
});

app.get('/choose-reino', ensureAuth, (req, res) => {
    if (req.user.reino) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'public/choose-reino.html'));
});

app.get('/admin', ensureAuth, ensureAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public/admin.html'));
});

app.get('/mapa', ensureAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public/mapa.html'));
});

app.use(express.json()); // Esto es importante para que pueda leer JSON

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


app.listen(PORT, () => console.log(`Servidor en http://localhost:${PORT}`));
