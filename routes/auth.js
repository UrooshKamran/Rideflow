const express  = require('express');
const bcrypt   = require('bcryptjs');
const db       = require('../db');
const { validateRegister } = require('../middleware/validate');
const router   = express.Router();

// GET /auth/login
router.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/dashboard');
    res.render('login', { error: req.flash('error'), success: req.flash('success') });
});

// POST /auth/login
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        req.flash('error', 'Email and password are required.');
        return res.redirect('/auth/login');
    }
    try {
        const [rows] = await db.query(
            'SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()]
        );
        if (!rows.length) {
            req.flash('error', 'Invalid email or password.');
            return res.redirect('/auth/login');
        }
        const user = rows[0];
        if (user.acc_status !== 'active') {
            req.flash('error', `Your account is ${user.acc_status}. Please contact support.`);
            return res.redirect('/auth/login');
        }
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            req.flash('error', 'Invalid email or password.');
            return res.redirect('/auth/login');
        }
        req.session.user = {
            user_id  : user.user_id,
            full_name: user.full_name,
            email    : user.email,
            role     : user.role
        };
        const redirectMap = {
            rider      : '/rider/dashboard',
            driver     : '/driver/dashboard',
            admin      : '/admin/dashboard',
            super_admin: '/admin/dashboard'
        };
        res.redirect(redirectMap[user.role] || '/');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Server error. Please try again.');
        res.redirect('/auth/login');
    }
});

// GET /auth/register
router.get('/register', (req, res) => {
    res.render('register', { error: req.flash('error') });
});

// POST /auth/register
router.post('/register', validateRegister, async (req, res) => {
    const { full_name, email, phone, password, role, cnic, license_num } = req.body;
    try {
        const [existing] = await db.query(
            'SELECT user_id FROM users WHERE email = ? OR phone = ?',
            [email.trim().toLowerCase(), phone.trim()]
        );
        if (existing.length) {
            req.flash('error', 'Email or phone number is already registered.');
            return res.redirect('/auth/register');
        }
        const hash = await bcrypt.hash(password, 10);
        const [result] = await db.query(
            `INSERT INTO users (full_name, email, phone, password_hash, role)
             VALUES (?, ?, ?, ?, ?)`,
            [full_name.trim(), email.trim().toLowerCase(), phone.trim(), hash, role]
        );
        if (role === 'driver') {
            await db.query(
                `INSERT INTO drivers (user_id, cnic, license_num) VALUES (?, ?, ?)`,
                [result.insertId, cnic.trim(), license_num.trim()]
            );
        }
        await db.query('INSERT INTO wallet (user_id) VALUES (?)', [result.insertId]);
        req.flash('success', 'Account created successfully! Please login.');
        res.redirect('/auth/login');
 } catch (err) {
        console.error(err);
        if (err.code === 'ER_DUP_ENTRY') {
            if (err.sqlMessage.includes('uq_users_email')) {
                req.flash('error', 'This email is already registered. Please login instead.');
            } else if (err.sqlMessage.includes('uq_users_phone')) {
                req.flash('error', 'This phone number is already registered.');
            } else if (err.sqlMessage.includes('uq_drivers_cnic')) {
                req.flash('error', 'This CNIC is already registered.');
            } else if (err.sqlMessage.includes('uq_drivers_license')) {
                req.flash('error', 'This license number is already registered.');
            } else {
                req.flash('error', 'An account with these details already exists.');
            }
        } else {
            req.flash('error', 'Registration failed. Please try again.');
        }
        res.redirect('/auth/register');
    }


});

// GET /auth/logout
router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/auth/login');
});

module.exports = router;