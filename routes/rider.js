const express = require('express');
const db      = require('../db');
const { isAuthenticated, hasRole } = require('../middleware/auth');
const { validateBookRide, validateTopup, validateRating } = require('../middleware/validate');
const router  = express.Router();

const guard = [isAuthenticated, hasRole('rider')];

// ── DASHBOARD ─────────────────────────────────────────────────
router.get('/dashboard', guard, async (req, res) => {
    const uid = req.session.user.user_id;
    try {
        const [[wallet]]    = await db.query('SELECT * FROM wallet WHERE user_id = ?', [uid]);
        const [recentRides] = await db.query(
            `SELECT r.*, pl.address AS pickup_address, pl.city AS pickup_city,
                    dl.address AS dropoff_address, d.avg_rating AS driver_rating,
                    u.full_name AS driver_name
             FROM rides r
             JOIN locations pl ON r.pickup_location_id  = pl.location_id
             JOIN locations dl ON r.dropoff_location_id = dl.location_id
             LEFT JOIN drivers d ON r.driver_id = d.driver_id
             LEFT JOIN users   u ON d.user_id   = u.user_id
             WHERE r.rider_id = ? ORDER BY r.created_at DESC LIMIT 5`, [uid]
        );
        res.render('rider/dashboard', {
            user: req.session.user, wallet, recentRides,
            error: req.flash('error'), success: req.flash('success')
        });
    } catch (err) {
        console.error(err);
        res.render('rider/dashboard', {
            user: req.session.user, wallet: null, recentRides: [],
            error: 'Failed to load dashboard.', success: null
        });
    }
});

// ── BOOK RIDE ─────────────────────────────────────────────────
router.get('/book', guard, async (req, res) => {
    try {
        const [promos] = await db.query(
            `SELECT * FROM promo_codes WHERE valid_until > NOW() AND usage_count < usage_limit`
        );
        res.render('rider/book', {
            user: req.session.user, promos,
            error: req.flash('error'), success: req.flash('success')
        });
    } catch (err) {
        res.render('rider/book', { user: req.session.user, promos: [], error: 'Failed to load.', success: null });
    }
});

router.post('/book', guard, validateBookRide, async (req, res) => {
    const uid = req.session.user.user_id;
    const { pickup_address, pickup_city, dropoff_address, dropoff_city,
            pickup_lat, pickup_lon, dropoff_lat, dropoff_lon,
            vehicle_type, scheduled_at } = req.body;
    try {
        // Check no active ride already
        const [activeRides] = await db.query(
            `SELECT ride_id FROM rides WHERE rider_id = ?
             AND status IN ('requested','accepted','driver_en_route','in_progress')`, [uid]
        );
        if (activeRides.length > 0) {
            req.flash('error', 'You already have an active ride. Complete or cancel it first.');
            return res.redirect('/rider/book');
        }
        const [pickupRes] = await db.query(
            `INSERT INTO locations (latitude, longitude, address, city) VALUES (?,?,?,?)`,
            [pickup_lat || 0, pickup_lon || 0, pickup_address.trim(), pickup_city.trim()]
        );
        const [dropoffRes] = await db.query(
            `INSERT INTO locations (latitude, longitude, address, city) VALUES (?,?,?,?)`,
            [dropoff_lat || 0, dropoff_lon || 0, dropoff_address.trim(), dropoff_city.trim()]
        );
        const [[rule]] = await db.query(
            `SELECT * FROM fare_rules WHERE city = ? AND vehicle_type = ?`,
            [pickup_city.trim(), vehicle_type || 'economy']
        );
        const [rideResult] = await db.query(
            `INSERT INTO rides
                (rider_id, driver_id, vehicle_id, pickup_location_id,
                dropoff_location_id, rule_id, status, scheduled_at)
                VALUES (?, NULL, NULL, ?, ?, ?, 'requested', ?)`,
            [uid, pickupRes.insertId, dropoffRes.insertId,
            rule ? rule.rule_id : null, scheduled_at || null]
        );


        req.flash('success', 'Ride requested! Waiting for an available driver to accept.');
        res.redirect('/rider/history');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to book ride. Please try again.');
        res.redirect('/rider/book');
    }
});

// ── HISTORY ───────────────────────────────────────────────────
router.get('/history', guard, async (req, res) => {
    const uid = req.session.user.user_id;
    try {
        const [rides] = await db.query(
            `SELECT r.*, pl.address AS pickup_address, pl.city AS pickup_city,
                    dl.address AS dropoff_address, u.full_name AS driver_name,
                    d.user_id AS driver_user_id,
                    p.amount, p.pay_method, p.pay_status, p.discount_appld
             FROM rides r
             JOIN locations pl ON r.pickup_location_id  = pl.location_id
             JOIN locations dl ON r.dropoff_location_id = dl.location_id
             LEFT JOIN drivers d  ON r.driver_id = d.driver_id
             LEFT JOIN users   u  ON d.user_id   = u.user_id
             LEFT JOIN payments p ON r.ride_id   = p.ride_id
             WHERE r.rider_id = ? ORDER BY r.created_at DESC`, [uid]
        );
        res.render('rider/history', {
            user: req.session.user, rides,
            error: req.flash('error'), success: req.flash('success')
        });
    } catch (err) {
        res.render('rider/history', {
            user: req.session.user, rides: [], error: 'Failed to load history.', success: null
        });
    }
});

// ── PAYMENT ───────────────────────────────────────────────────
router.get('/pay/:ride_id', guard, async (req, res) => {
    const uid = req.session.user.user_id;
    try {
        const [[ride]] = await db.query(
            `SELECT r.*, pl.address AS pickup_address, dl.address AS dropoff_address,
                    u.full_name AS driver_name
             FROM rides r
             JOIN locations pl ON r.pickup_location_id  = pl.location_id
             JOIN locations dl ON r.dropoff_location_id = dl.location_id
             LEFT JOIN drivers d ON r.driver_id = d.driver_id
             LEFT JOIN users   u ON d.user_id   = u.user_id
             WHERE r.ride_id = ? AND r.rider_id = ?`,
            [req.params.ride_id, uid]
        );
        if (!ride) {
            req.flash('error', 'Ride not found.');
            return res.redirect('/rider/history');
        }
        if (!ride.fare) {
            req.flash('error', 'Fare not calculated yet. Please wait for the driver to complete the ride.');
            return res.redirect('/rider/history');
        }
        const [[existing]] = await db.query('SELECT * FROM payments WHERE ride_id = ?', [req.params.ride_id]);
        if (existing && existing.pay_status === 'paid') {
            req.flash('error', 'This ride has already been paid.');
            return res.redirect('/rider/history');
        }
        const [[wallet]] = await db.query('SELECT * FROM wallet WHERE user_id = ?', [uid]);
        const [promos]   = await db.query(
            `SELECT * FROM promo_codes WHERE valid_until > NOW() AND usage_count < usage_limit`
        );
        res.render('rider/pay', {
            user: req.session.user, ride, wallet, promos,
            error: req.flash('error'), success: req.flash('success')
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load payment page.');
        res.redirect('/rider/history');
    }
});

router.post('/pay/:ride_id', guard, async (req, res) => {
    const uid = req.session.user.user_id;
    const { pay_method, promo_code } = req.body;
    const ride_id = req.params.ride_id;

    if (!['cash', 'wallet', 'card'].includes(pay_method)) {
        req.flash('error', 'Invalid payment method selected.');
        return res.redirect(`/rider/pay/${ride_id}`);
    }
    try {
        const [[ride]] = await db.query(
            'SELECT * FROM rides WHERE ride_id = ? AND rider_id = ?', [ride_id, uid]
        );
        if (!ride || !ride.fare) {
            req.flash('error', 'Ride not found or fare not calculated yet.');
            return res.redirect('/rider/history');
        }
        const [[existing]] = await db.query('SELECT * FROM payments WHERE ride_id = ?', [ride_id]);
        if (existing && existing.pay_status === 'paid') {
            req.flash('error', 'This ride is already paid.');
            return res.redirect('/rider/history');
        }

        let discount = 0, promo_id = null;
        if (promo_code && promo_code.trim() !== '') {
            const [[promo]] = await db.query(
                `SELECT * FROM promo_codes WHERE code = ? AND valid_until > NOW() AND usage_count < usage_limit`,
                [promo_code.trim()]
            );
            if (!promo) {
                req.flash('error', 'Invalid or expired promo code.');
                return res.redirect(`/rider/pay/${ride_id}`);
            }
            discount  = Math.round((ride.fare * promo.discount_pct / 100) * 100) / 100;
            promo_id  = promo.promo_id;
        }

        const finalAmount = Math.max(0, parseFloat(ride.fare) - discount);

        if (pay_method === 'wallet') {
            const [[wallet]] = await db.query('SELECT * FROM wallet WHERE user_id = ?', [uid]);
            if (!wallet || parseFloat(wallet.balance) < finalAmount) {
                req.flash('error',
                    `Insufficient wallet balance (Rs. ${wallet ? parseFloat(wallet.balance).toFixed(2) : '0.00'}). Please top up or use another method.`
                );
                return res.redirect(`/rider/pay/${ride_id}`);
            }
            await db.query('UPDATE wallet SET balance = balance - ? WHERE user_id = ?', [finalAmount, uid]);
        }

        if (existing) {
            await db.query(
                `UPDATE payments SET pay_method=?, pay_status='paid',
                 amount=?, discount_appld=?, promo_id=?, transaction_date=NOW()
                 WHERE ride_id=?`,
                [pay_method, finalAmount, discount, promo_id, ride_id]
            );
        } else {
            await db.query(
                `INSERT INTO payments (ride_id, rider_id, amount, pay_method, pay_status, discount_appld, promo_id)
                 VALUES (?, ?, ?, ?, 'paid', ?, ?)`,
                [ride_id, uid, finalAmount, pay_method, discount, promo_id]
            );
        }
        req.flash('success', `Payment of Rs. ${finalAmount.toFixed(2)} successful!`);
        res.redirect('/rider/history');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Payment failed. Please try again.');
        res.redirect(`/rider/pay/${ride_id}`);
    }
});

// ── WALLET ────────────────────────────────────────────────────
router.get('/wallet', guard, async (req, res) => {
    const uid = req.session.user.user_id;
    try {
        const [[wallet]] = await db.query('SELECT * FROM wallet WHERE user_id = ?', [uid]);
        res.render('rider/wallet', {
            user: req.session.user, wallet,
            error: req.flash('error'), success: req.flash('success')
        });
    } catch (err) {
        res.render('rider/wallet', { user: req.session.user, wallet: null, error: 'Failed.', success: null });
    }
});

router.post('/wallet/topup', guard, validateTopup, async (req, res) => {
    const uid = req.session.user.user_id;
    try {
        await db.query('UPDATE wallet SET balance = balance + ? WHERE user_id = ?',
            [parseFloat(req.body.amount), uid]);
        req.flash('success', `Rs. ${parseFloat(req.body.amount).toFixed(2)} added to your wallet.`);
        res.redirect('/rider/wallet');
    } catch (err) {
        req.flash('error', 'Top up failed.');
        res.redirect('/rider/wallet');
    }
});

// ── RATINGS ───────────────────────────────────────────────────
router.post('/rate/:ride_id', guard, validateRating, async (req, res) => {
    const uid = req.session.user.user_id;
    const { score, comment, rated_user_id } = req.body;
    const ride_id = req.params.ride_id;
    try {
        const [[ride]] = await db.query(
            'SELECT * FROM rides WHERE ride_id = ? AND rider_id = ?', [ride_id, uid]
        );
        if (!ride) {
            req.flash('error', 'You can only rate your own rides.');
            return res.redirect('/rider/history');
        }
        if (ride.status !== 'completed') {
            req.flash('error', 'You can only rate completed rides.');
            return res.redirect('/rider/history');
        }
        const [[existing]] = await db.query(
            'SELECT * FROM ratings WHERE ride_id = ? AND rated_by = ?', [ride_id, uid]
        );
        if (existing) {
            req.flash('error', 'You have already rated this ride.');
            return res.redirect('/rider/history');
        }
        await db.query(
            `INSERT INTO ratings (ride_id, rated_by, rated_user_id, rater_role, score, comment)
             VALUES (?, ?, ?, 'rider', ?, ?)`,
            [ride_id, uid, rated_user_id, parseInt(score), comment ? comment.trim() : null]
        );
        req.flash('success', 'Rating submitted! Thank you.');
        res.redirect('/rider/history');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to submit rating.');
        res.redirect('/rider/history');
    }
});

module.exports = router;