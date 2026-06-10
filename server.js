require('dotenv').config();
const express      = require('express');
const session      = require('express-session');
const flash        = require('connect-flash');
const methodOverride = require('method-override');
const path         = require('path');

const app = express();

// ── View engine ───────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Middleware ────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret           : process.env.SESSION_SECRET || 'rideflow_secret',
    resave           : false,
    saveUninitialized: false,
    cookie           : { maxAge: 24 * 60 * 60 * 1000 }
}));
app.use(flash());

// Make user available in all views
app.use((req, res, next) => {
    res.locals.user    = req.session.user || null;
    res.locals.success = req.flash('success');
    res.locals.error   = req.flash('error');
    next();
});

// ── Routes ────────────────────────────────────────────────────
app.use('/auth',   require('./routes/auth'));
app.use('/rider',  require('./routes/rider'));
app.use('/driver', require('./routes/driver'));
app.use('/admin',  require('./routes/admin'));

// Root redirect
app.get('/', (req, res) => {
    if (!req.session.user) return res.redirect('/auth/login');
    const map = {
        rider      : '/rider/dashboard',
        driver     : '/driver/dashboard',
        admin      : '/admin/dashboard',
        super_admin: '/admin/dashboard'
    };
    res.redirect(map[req.session.user.role] || '/auth/login');
});

app.get('/dashboard', (req, res) => res.redirect('/'));

// 403 page
app.get('/403', (req, res) => res.status(403).render('403', { user: req.session.user }));

// 404
app.use((req, res) => res.status(404).render('404', { user: req.session.user || null }));

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(` RideFlow running at http://localhost:${PORT}`);
});
