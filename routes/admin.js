const express = require('express');
const db      = require('../db');
const bcrypt  = require('bcryptjs');
const { isAuthenticated, hasRole } = require('../middleware/auth');
const { validateFareRule, validatePromo } = require('../middleware/validate');
const router  = express.Router();

const guard = [isAuthenticated, hasRole('admin', 'super_admin')];

// ── DASHBOARD ─────────────────────────────────────────────────
router.get('/dashboard', guard, async (req, res) => {
    try {
        const [[totalUsers]]   = await db.query('SELECT COUNT(*) AS cnt FROM users');
        const [[totalDrivers]] = await db.query('SELECT COUNT(*) AS cnt FROM drivers');
        const [[totalRides]]   = await db.query('SELECT COUNT(*) AS cnt FROM rides');
        const [[totalRevenue]] = await db.query(
            `SELECT SUM(amount) AS total FROM payments WHERE pay_status = 'paid'`
        );
        const [revenueByCity] = await db.query(
            `SELECT l.city, SUM(p.amount) AS revenue, COUNT(r.ride_id) AS rides
             FROM payments p
             JOIN rides     r ON p.ride_id            = r.ride_id
             JOIN locations l ON r.pickup_location_id = l.location_id
             WHERE p.pay_status = 'paid'
             GROUP BY l.city ORDER BY revenue DESC LIMIT 10`
        );
        const [revenueByMethod] = await db.query(
            `SELECT pay_method, SUM(amount) AS total, COUNT(*) AS count
             FROM payments WHERE pay_status = 'paid'
             GROUP BY pay_method`
        );
        const [recentRides] = await db.query(
            `SELECT r.ride_id, r.status, r.fare, r.created_at,
                    ur.full_name AS rider_name,
                    ud.full_name AS driver_name,
                    pl.city
             FROM rides r
             JOIN users     ur ON r.rider_id              = ur.user_id
             LEFT JOIN drivers d  ON r.driver_id          = d.driver_id
             LEFT JOIN users  ud  ON d.user_id            = ud.user_id
             JOIN locations   pl  ON r.pickup_location_id = pl.location_id
             ORDER BY r.created_at DESC LIMIT 10`
        );
        const [lowRatedDrivers] = await db.query(
            `SELECT u.full_name, d.avg_rating, d.verify_status, d.avail_status, d.driver_id
             FROM drivers d JOIN users u ON d.user_id = u.user_id
             WHERE d.avg_rating < 3.5 AND d.avg_rating > 0
             ORDER BY d.avg_rating ASC`
        );
        res.render('admin/dashboard', {
            user: req.session.user,
            stats: {
                totalUsers  : totalUsers.cnt,
                totalDrivers: totalDrivers.cnt,
                totalRides  : totalRides.cnt,
                totalRevenue: totalRevenue.total || 0
            },
            revenueByCity, revenueByMethod, recentRides, lowRatedDrivers,
            error: req.flash('error'), success: req.flash('success')
        });
    } catch (err) {
        console.error(err);
        res.render('admin/dashboard', {
            user: req.session.user, stats: {}, revenueByCity: [],
            revenueByMethod: [], recentRides: [], lowRatedDrivers: [],
            error: 'Failed to load dashboard.', success: null
        });
    }
});

// ── USERS ─────────────────────────────────────────────────────
router.get('/users', guard, async (req, res) => {
    try {
        const [users] = await db.query(
            `SELECT u.*,
                    COALESCE(d.verify_status, 'N/A') AS driver_verify,
                    COALESCE(d.avg_rating, 0)         AS driver_rating
             FROM users u
             LEFT JOIN drivers d ON u.user_id = d.user_id
             ORDER BY u.registration_date DESC`
        );
        res.render('admin/users', {
            user: req.session.user, users,
            error: req.flash('error'), success: req.flash('success')
        });
    } catch (err) {
        res.render('admin/users', {
            user: req.session.user, users: [], error: 'Failed to load.', success: null
        });
    }
});

router.post('/users/:id/status', guard, async (req, res) => {
    const { status } = req.body;
    if (!['active','suspended','banned'].includes(status)) {
        req.flash('error', 'Invalid status.');
        return res.redirect('/admin/users');
    }
    try {
        await db.query('UPDATE users SET acc_status = ? WHERE user_id = ?', [status, req.params.id]);
        req.flash('success', 'User status updated.');
        res.redirect('/admin/users');
    } catch (err) {
        req.flash('error', 'Update failed.');
        res.redirect('/admin/users');
    }
});

// ── DRIVERS ───────────────────────────────────────────────────
router.get('/drivers', guard, async (req, res) => {
    try {
        const [drivers] = await db.query(
            `SELECT d.*, u.full_name, u.email, u.phone, u.acc_status,
                    COUNT(v.vehicle_id) AS vehicle_count
             FROM drivers d
             JOIN users    u ON d.user_id   = u.user_id
             LEFT JOIN vehicles v ON d.driver_id = v.driver_id
             GROUP BY d.driver_id
             ORDER BY d.avg_rating DESC`
        );
        res.render('admin/drivers', {
            user: req.session.user, drivers,
            error: req.flash('error'), success: req.flash('success')
        });
    } catch (err) {
        res.render('admin/drivers', {
            user: req.session.user, drivers: [], error: 'Failed to load.', success: null
        });
    }
});

router.post('/drivers/:id/verify', guard, async (req, res) => {
    const { status } = req.body;
    if (!['verified','rejected','pending'].includes(status)) {
        req.flash('error', 'Invalid status.');
        return res.redirect('/admin/drivers');
    }
    try {
        await db.query('UPDATE drivers SET verify_status = ? WHERE driver_id = ?', [status, req.params.id]);
        req.flash('success', 'Driver verification updated.');
        res.redirect('/admin/drivers');
    } catch (err) {
        req.flash('error', 'Update failed.');
        res.redirect('/admin/drivers');
    }
});

// ── VEHICLES ──────────────────────────────────────────────────
router.get('/vehicles', guard, async (req, res) => {
    try {
        const [vehicles] = await db.query(
            `SELECT v.*, u.full_name AS driver_name
             FROM vehicles v
             JOIN drivers d ON v.driver_id = d.driver_id
             JOIN users   u ON d.user_id   = u.user_id
             ORDER BY
                CASE v.verify_status
                    WHEN 'pending'  THEN 1
                    WHEN 'verified' THEN 2
                    WHEN 'rejected' THEN 3
                END`
        );
        res.render('admin/vehicles', {
            user: req.session.user, vehicles,
            error: req.flash('error'), success: req.flash('success')
        });
    } catch (err) {
        console.error(err);
        res.render('admin/vehicles', {
            user: req.session.user, vehicles: [], error: 'Failed to load vehicles.', success: null
        });
    }
});

router.post('/vehicles/:id/verify', guard, async (req, res) => {
    const { status } = req.body;
    if (!['verified','rejected','pending'].includes(status)) {
        req.flash('error', 'Invalid status.');
        return res.redirect('/admin/vehicles');
    }
    try {
        await db.query('UPDATE vehicles SET verify_status = ? WHERE vehicle_id = ?', [status, req.params.id]);
        req.flash('success', `Vehicle ${status} successfully.`);
        res.redirect('/admin/vehicles');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to update vehicle status.');
        res.redirect('/admin/vehicles');
    }
});

// ── FARE RULES ────────────────────────────────────────────────
router.get('/fare-rules', guard, async (req, res) => {
    try {
        const [rules] = await db.query('SELECT * FROM fare_rules ORDER BY city, vehicle_type');
        res.render('admin/fare-rules', {
            user: req.session.user, rules,
            error: req.flash('error'), success: req.flash('success')
        });
    } catch (err) {
        res.render('admin/fare-rules', {
            user: req.session.user, rules: [], error: 'Failed to load.', success: null
        });
    }
});

router.post('/fare-rules', guard, validateFareRule, async (req, res) => {
    const { city, vehicle_type, base_rate, per_km_rate, per_min_rate, surge_multi } = req.body;
    try {
        await db.query(
            `INSERT INTO fare_rules (city, vehicle_type, base_rate, per_km_rate, per_min_rate, surge_multi)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
             base_rate    = VALUES(base_rate),
             per_km_rate  = VALUES(per_km_rate),
             per_min_rate = VALUES(per_min_rate),
             surge_multi  = VALUES(surge_multi)`,
            [city.trim(), vehicle_type,
             parseFloat(base_rate), parseFloat(per_km_rate),
             parseFloat(per_min_rate), parseFloat(surge_multi) || 1.00]
        );
        req.flash('success', 'Fare rule saved successfully.');
        res.redirect('/admin/fare-rules');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to save fare rule.');
        res.redirect('/admin/fare-rules');
    }
});

// ── REPORTS ───────────────────────────────────────────────────
router.get('/reports', guard, async (req, res) => {
    const { from, to } = req.query;
    const dateFrom = from || new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0];
    const dateTo   = to   || new Date().toISOString().split('T')[0];
    try {
        const [[revenue]] = await db.query(
            `SELECT SUM(amount) AS total, COUNT(*) AS count
             FROM payments WHERE pay_status = 'paid'
             AND transaction_date BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)`,
            [dateFrom, dateTo]
        );
        const [driverEarnings] = await db.query(
            `SELECT u.full_name, SUM(de.gross_amount) AS gross,
                    SUM(de.commission) AS commission, SUM(de.net_amount) AS net,
                    COUNT(de.earning_id) AS trips
             FROM driver_earnings de
             JOIN drivers d ON de.driver_id = d.driver_id
             JOIN users   u ON d.user_id    = u.user_id
             WHERE de.earned_at BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)
             GROUP BY de.driver_id ORDER BY gross DESC`, [dateFrom, dateTo]
        );
        const [[refunds]] = await db.query(
            `SELECT SUM(amount) AS total, COUNT(*) AS count
             FROM payments WHERE pay_status = 'refunded'
             AND transaction_date BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)`,
            [dateFrom, dateTo]
        );
        const [tripsPerDriver] = await db.query(
            `SELECT u.full_name, COUNT(r.ride_id) AS total_trips, d.avg_rating
             FROM drivers d
             JOIN users u ON d.user_id = u.user_id
             LEFT JOIN rides r ON d.driver_id = r.driver_id AND r.status = 'completed'
             GROUP BY d.driver_id
             ORDER BY total_trips DESC`
        );
        res.render('admin/reports', {
            user: req.session.user,
            revenue, driverEarnings, refunds, tripsPerDriver,
            dateFrom, dateTo, error: req.flash('error')
        });
    } catch (err) {
        console.error(err);
        res.render('admin/reports', {
            user: req.session.user, revenue: null, driverEarnings: [],
            refunds: null, tripsPerDriver: [], dateFrom, dateTo,
            error: 'Failed to load reports.'
        });
    }
});

// ── PROMO CODES ───────────────────────────────────────────────
router.get('/promos', guard, async (req, res) => {
    try {
        const [promos] = await db.query('SELECT * FROM promo_codes ORDER BY valid_until DESC');
        res.render('admin/promos', {
            user: req.session.user, promos,
            error: req.flash('error'), success: req.flash('success')
        });
    } catch (err) {
        res.render('admin/promos', {
            user: req.session.user, promos: [], error: 'Failed to load.', success: null
        });
    }
});

router.post('/promos', guard, validatePromo, async (req, res) => {
    const { code, discount_pct, usage_limit, valid_from, valid_until } = req.body;
    try {
        const [[existing]] = await db.query(
            'SELECT promo_id FROM promo_codes WHERE code = ?', [code.trim().toUpperCase()]
        );
        if (existing) {
            req.flash('error', 'A promo code with this name already exists.');
            return res.redirect('/admin/promos');
        }
        await db.query(
            `INSERT INTO promo_codes (code, discount_pct, usage_limit, valid_from, valid_until)
             VALUES (?, ?, ?, ?, ?)`,
            [code.trim().toUpperCase(), parseFloat(discount_pct),
             parseInt(usage_limit), valid_from, valid_until]
        );
        req.flash('success', 'Promo code created successfully.');
        res.redirect('/admin/promos');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to create promo code.');
        res.redirect('/admin/promos');
    }
});

// ── PAYOUTS ───────────────────────────────────────────────────
router.get('/payouts', guard, async (req, res) => {
    try {
        const [payouts] = await db.query(
            `SELECT
                de.driver_id,
                u.full_name,
                u.email,
                w.balance        AS wallet_balance,
                w.payout_status  AS wallet_payout_status,
                w.last_payout_date,
                COUNT(de.earning_id) AS pending_count,
                SUM(de.net_amount)   AS pending_total
             FROM driver_earnings de
             JOIN drivers d ON de.driver_id = d.driver_id
             JOIN users   u ON d.user_id    = u.user_id
             JOIN wallet  w ON u.user_id    = w.user_id
             WHERE de.payout_status = 'pending'
             GROUP BY
                de.driver_id, u.full_name, u.email,
                w.balance, w.payout_status, w.last_payout_date
             ORDER BY pending_total DESC`
        );
        res.render('admin/payouts', {
            user: req.session.user, payouts,
            error: req.flash('error'), success: req.flash('success')
        });
    } catch (err) {
        console.error(err);
        res.render('admin/payouts', {
            user: req.session.user, payouts: [],
            error: 'Failed to load payouts.', success: null
        });
    }
});

router.post('/payouts/:driver_id/approve', guard, async (req, res) => {
    try {
        await db.query(
            `UPDATE driver_earnings SET payout_status = 'paid'
             WHERE driver_id = ? AND payout_status = 'pending'`,
            [req.params.driver_id]
        );
        await db.query(
            `UPDATE wallet w
             JOIN drivers d ON d.user_id = w.user_id
             SET w.balance = 0, w.payout_status = 'completed', w.last_payout_date = NOW()
             WHERE d.driver_id = ?`,
            [req.params.driver_id]
        );
        req.flash('success', 'Payout approved and processed successfully.');
        res.redirect('/admin/payouts');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to process payout.');
        res.redirect('/admin/payouts');
    }
});

// ── LEADERBOARD ───────────────────────────────────────────────
router.get('/leaderboard', guard, async (req, res) => {
    try {
        const [leaderboard] = await db.query(
            `SELECT
                u.full_name, u.phone,
                d.avg_rating, d.total_trips, d.avail_status,
                primary_city.city,
                RANK() OVER (PARTITION BY primary_city.city ORDER BY d.avg_rating DESC) AS city_rank
             FROM drivers d
             JOIN users u ON d.user_id = u.user_id
             JOIN (
                 SELECT r2.driver_id, l2.city, COUNT(*) AS ride_count
                 FROM rides r2
                 JOIN locations l2 ON r2.pickup_location_id = l2.location_id
                 WHERE r2.status = 'completed'
                 GROUP BY r2.driver_id, l2.city
                 HAVING ride_count = (
                     SELECT MAX(cnt) FROM (
                         SELECT COUNT(*) AS cnt
                         FROM rides r3
                         JOIN locations l3 ON r3.pickup_location_id = l3.location_id
                         WHERE r3.driver_id = r2.driver_id AND r3.status = 'completed'
                         GROUP BY l3.city
                     ) AS sub
                 )
             ) AS primary_city ON primary_city.driver_id = d.driver_id
             WHERE d.verify_status = 'verified' AND d.avg_rating > 0
             GROUP BY d.driver_id, primary_city.city
             ORDER BY primary_city.city, d.avg_rating DESC`
        );
        res.render('admin/leaderboard', {
            user: req.session.user, leaderboard,
            error: req.flash('error')
        });
    } catch (err) {
        console.error(err);
        res.render('admin/leaderboard', {
            user: req.session.user, leaderboard: [],
            error: 'Failed to load leaderboard.'
        });
    }
});

module.exports = router;
