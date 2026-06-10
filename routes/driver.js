const express = require('express');
const db      = require('../db');
const { isAuthenticated, hasRole } = require('../middleware/auth');
const { validateCompleteRide, validateAddVehicle, validateRating } = require('../middleware/validate');
const router  = express.Router();

const guard = [isAuthenticated, hasRole('driver')];

// ── DASHBOARD ─────────────────────────────────────────────────
router.get('/dashboard', guard, async (req, res) => {
    const uid = req.session.user.user_id;
    try {
        const [[driver]] = await db.query('SELECT * FROM drivers WHERE user_id = ?', [uid]);
        const [[wallet]]  = await db.query('SELECT * FROM wallet  WHERE user_id = ?', [uid]);

        // All open requested rides
        const [pending] = await db.query(
            `SELECT r.*,
                    pl.address AS pickup_address, pl.city AS pickup_city,
                    dl.address AS dropoff_address,
                    u.full_name AS rider_name,
                    fr.vehicle_type AS requested_vehicle_type
             FROM rides r
             JOIN locations pl ON r.pickup_location_id  = pl.location_id
             JOIN locations dl ON r.dropoff_location_id = dl.location_id
             JOIN users     u  ON r.rider_id            = u.user_id
             LEFT JOIN fare_rules fr ON r.rule_id       = fr.rule_id
             WHERE r.status = 'requested'
             AND (r.driver_id IS NULL OR r.driver_id = ?)
             ORDER BY r.created_at DESC`, [driver.driver_id]
        );

        // Active rides for THIS driver
        const [activeRides] = await db.query(
            `SELECT r.*,
                    pl.address AS pickup_address, pl.city AS pickup_city,
                    dl.address AS dropoff_address,
                    u.full_name AS rider_name,
                    u.user_id  AS rider_user_id
             FROM rides r
             JOIN locations pl ON r.pickup_location_id  = pl.location_id
             JOIN locations dl ON r.dropoff_location_id = dl.location_id
             JOIN users     u  ON r.rider_id            = u.user_id
             WHERE r.driver_id = ?
             AND r.status IN ('accepted','driver_en_route','in_progress')
             ORDER BY r.created_at DESC`, [driver.driver_id]
        );

        const [recentEarnings] = await db.query(
            `SELECT de.*, r.created_at AS ride_date
             FROM driver_earnings de
             JOIN rides r ON de.ride_id = r.ride_id
             WHERE de.driver_id = ?
             ORDER BY de.earned_at DESC LIMIT 5`, [driver.driver_id]
        );

        res.render('driver/dashboard', {
            user: req.session.user, driver, wallet,
            pending, activeRides, recentEarnings,
            error: req.flash('error'), success: req.flash('success')
        });
    } catch (err) {
        console.error(err);
        res.render('driver/dashboard', {
            user: req.session.user, driver: null, wallet: null,
            pending: [], activeRides: [], recentEarnings: [],
            error: 'Failed to load.', success: null
        });
    }
});

// ── PROFILE ───────────────────────────────────────────────────
router.get('/profile', guard, async (req, res) => {
    const uid = req.session.user.user_id;
    try {
        const [[driver]] = await db.query(
            `SELECT d.*, u.full_name, u.email, u.phone
             FROM drivers d JOIN users u ON d.user_id = u.user_id
             WHERE d.user_id = ?`, [uid]
        );
        const [vehicles] = await db.query(
            'SELECT * FROM vehicles WHERE driver_id = ?', [driver.driver_id]
        );
        res.render('driver/profile', {
            user: req.session.user, driver, vehicles,
            error: req.flash('error'), success: req.flash('success')
        });
    } catch (err) {
        req.flash('error', 'Failed to load profile.');
        res.redirect('/driver/dashboard');
    }
});

// ── TOGGLE AVAILABILITY ───────────────────────────────────────
router.post('/toggle-status', guard, async (req, res) => {
    const uid = req.session.user.user_id;
    try {
        const [[driver]] = await db.query('SELECT * FROM drivers WHERE user_id = ?', [uid]);
        const newStatus  = driver.avail_status === 'online' ? 'offline' : 'online';
        await db.query("UPDATE drivers SET avail_status = ? WHERE user_id = ?", [newStatus, uid]);
        req.flash('success', `You are now ${newStatus}.`);
        res.redirect('/driver/dashboard');
    } catch (err) {
        req.flash('error', 'Failed to update status.');
        res.redirect('/driver/dashboard');
    }
});

// ── ADD VEHICLE ───────────────────────────────────────────────
router.get('/vehicles/add', guard, async (req, res) => {
    res.render('driver/add-vehicle', {
        user: req.session.user,
        error: req.flash('error'), success: req.flash('success')
    });
});

router.post('/vehicles/add', guard, validateAddVehicle, async (req, res) => {
    const uid = req.session.user.user_id;
    const { make, model, year, color, license_plate, vehicle_type } = req.body;
    try {
        const [[driver]]   = await db.query('SELECT * FROM drivers WHERE user_id = ?', [uid]);
        const [[existing]] = await db.query(
            'SELECT * FROM vehicles WHERE license_plate = ?', [license_plate]
        );
        if (existing) {
            req.flash('error', 'A vehicle with this license plate already exists.');
            return res.redirect('/driver/vehicles/add');
        }
        await db.query(
            `INSERT INTO vehicles (driver_id, make, model, year, color, license_plate, vehicle_type, verify_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [driver.driver_id, make.trim(), model.trim(), year, color.trim(), license_plate.trim().toUpperCase(), vehicle_type]
        );
        req.flash('success', 'Vehicle registered! Awaiting admin verification.');
        res.redirect('/driver/profile');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to register vehicle.');
        res.redirect('/driver/vehicles/add');
    }
});

// ── ACCEPT RIDE ───────────────────────────────────────────────
router.post('/accept/:ride_id', guard, async (req, res) => {
    const uid = req.session.user.user_id;
    try {
        const [[driver]] = await db.query('SELECT * FROM drivers WHERE user_id = ?', [uid]);
        if (driver.verify_status !== 'verified') {
            req.flash('error', 'Your driver profile is not verified yet.');
            return res.redirect('/driver/dashboard');
        }
        const [[vehicle]] = await db.query(
            `SELECT * FROM vehicles WHERE driver_id = ? AND verify_status = 'verified' LIMIT 1`,
            [driver.driver_id]
        );
        if (!vehicle) {
            req.flash('error', 'You need a verified vehicle to accept rides.');
            return res.redirect('/driver/dashboard');
        }
        await db.query(
            `UPDATE rides SET status = 'accepted', driver_id = ?, vehicle_id = ?
             WHERE ride_id = ? AND status = 'requested'`,
            [driver.driver_id, vehicle.vehicle_id, req.params.ride_id]
        );
        await db.query(
            "UPDATE drivers SET avail_status = 'on_trip' WHERE driver_id = ?",
            [driver.driver_id]
        );
        req.flash('success', 'Ride accepted! Head to the pickup location.');
        res.redirect('/driver/dashboard');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to accept ride.');
        res.redirect('/driver/dashboard');
    }
});

// ── REJECT RIDE — auto assign next driver ─────────────────────
router.post('/reject/:ride_id', guard, async (req, res) => {
    const uid = req.session.user.user_id;
    try {
        const [[driver]] = await db.query('SELECT * FROM drivers WHERE user_id = ?', [uid]);
        const [[ride]]   = await db.query(
            `SELECT r.*, fr.vehicle_type AS req_vehicle_type
             FROM rides r
             LEFT JOIN fare_rules fr ON r.rule_id = fr.rule_id
             WHERE r.ride_id = ?`, [req.params.ride_id]
        );
        // Call SP to find and assign next driver
        await db.query('CALL AssignNextDriver(?, ?, ?)', [
            req.params.ride_id,
            driver.driver_id,
            ride.req_vehicle_type || 'economy'
        ]);
        req.flash('success', 'Ride rejected. System will find another driver.');
        res.redirect('/driver/dashboard');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to reject ride.');
        res.redirect('/driver/dashboard');
    }
});

// ── UPDATE RIDE STATUS (En Route / In Progress) ───────────────
router.post('/status/:ride_id', guard, async (req, res) => {
    const { new_status } = req.body;
    const allowed = ['driver_en_route', 'in_progress'];
    try {
        if (!allowed.includes(new_status)) {
            req.flash('error', 'Invalid status.');
            return res.redirect('/driver/dashboard');
        }
        await db.query(
            'UPDATE rides SET status = ? WHERE ride_id = ?',
            [new_status, req.params.ride_id]
        );
        const label = new_status === 'driver_en_route' ? 'En Route' : 'In Progress';
        req.flash('success', `Status updated to: ${label}`);
        res.redirect('/driver/dashboard');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to update ride status.');
        res.redirect('/driver/dashboard');
    }
});

// ── COMPLETE RIDE ─────────────────────────────────────────────
router.post('/complete/:ride_id', guard, validateCompleteRide, async (req, res) => {
    const uid = req.session.user.user_id;
    const { distance, duration } = req.body;
    try {
        const [[driver]] = await db.query('SELECT * FROM drivers WHERE user_id = ?', [uid]);

        // Try stored procedure — if it fails continue anyway
        try {
            await db.query('CALL CalculateFare(?, ?, ?)',
                [req.params.ride_id, parseFloat(distance), parseInt(duration)]
            );
        } catch (spErr) {
            console.error('CalculateFare SP error:', spErr.message);
            // SP failed — manually calculate fare as fallback
            const [[ride]] = await db.query('SELECT * FROM rides WHERE ride_id = ?', [req.params.ride_id]);
            if (ride && ride.rule_id) {
                const [[rule]] = await db.query('SELECT * FROM fare_rules WHERE rule_id = ?', [ride.rule_id]);
                if (rule) {
                    const fare = (parseFloat(rule.base_rate) +
                        (parseFloat(rule.per_km_rate) * parseFloat(distance)) +
                        (parseFloat(rule.per_min_rate) * parseInt(duration))) *
                        parseFloat(rule.surge_multi);
                    const commission = Math.round(fare * 0.20 * 100) / 100;
                    const net = Math.round((fare - commission) * 100) / 100;
                    await db.query('UPDATE rides SET fare = ? WHERE ride_id = ?', [fare, req.params.ride_id]);
                    await db.query(
                        `INSERT INTO driver_earnings (ride_id, driver_id, gross_amount, commission, net_amount)
                         VALUES (?, ?, ?, ?, ?)
                         ON DUPLICATE KEY UPDATE gross_amount=?, commission=?, net_amount=?`,
                        [req.params.ride_id, driver.driver_id, fare, commission, net, fare, commission, net]
                    );
                    await db.query(
                        'UPDATE wallet SET balance = balance + ? WHERE user_id = ?',
                        [net, uid]
                    );
                }
            }
        }

        // Force complete the ride
        await db.query(
            `UPDATE rides 
             SET status = 'completed', distance = ?, duration = ?, completed_at = NOW()
             WHERE ride_id = ?`,
            [parseFloat(distance), parseInt(duration), req.params.ride_id]
        );

        // Set driver online and increment trips
        await db.query(
            "UPDATE drivers SET avail_status = 'online', total_trips = total_trips + 1 WHERE driver_id = ?",
            [driver.driver_id]
        );

        // Archive ride
        await db.query(
            `INSERT IGNORE INTO ride_history (ride_id, outcome, final_fare)
             SELECT ride_id, 'completed', COALESCE(fare, 0) FROM rides WHERE ride_id = ?`,
            [req.params.ride_id]
        );

        req.flash('success', 'Ride completed! Rider can now make payment.');
        res.redirect('/driver/trips');
    } catch (err) {
        console.error('Complete ride error:', err.message);
        req.flash('error', 'Failed to complete ride: ' + err.message);
        res.redirect('/driver/dashboard');
    }
});

// ── RATE RIDER ────────────────────────────────────────────────
router.post('/rate/:ride_id', guard, validateRating, async (req, res) => {
    const uid = req.session.user.user_id;
    const { score, comment, rated_user_id } = req.body;
    try {
        await db.query(
            `INSERT INTO ratings (ride_id, rated_by, rated_user_id, rater_role, score, comment)
             VALUES (?, ?, ?, 'driver', ?, ?)`,
            [req.params.ride_id, uid, rated_user_id, score, comment || null]
        );
        req.flash('success', 'Rider rated successfully!');
        res.redirect('/driver/trips');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to submit rating. Already rated this rider.');
        res.redirect('/driver/trips');
    }
});

// ── TRIP HISTORY ──────────────────────────────────────────────
router.get('/trips', guard, async (req, res) => {
    const uid = req.session.user.user_id;
    try {
        const [[driver]] = await db.query('SELECT * FROM drivers WHERE user_id = ?', [uid]);
        const [trips]    = await db.query(
            `SELECT r.*,
                    pl.address AS pickup_address, pl.city AS pickup_city,
                    dl.address AS dropoff_address,
                    u.full_name AS rider_name,
                    u.user_id  AS rider_user_id,
                    de.gross_amount, de.commission, de.net_amount, de.payout_status
             FROM rides r
             JOIN locations pl     ON r.pickup_location_id  = pl.location_id
             JOIN locations dl     ON r.dropoff_location_id = dl.location_id
             JOIN users     u      ON r.rider_id            = u.user_id
             LEFT JOIN driver_earnings de ON r.ride_id      = de.ride_id
             WHERE r.driver_id = ?
             ORDER BY r.created_at DESC`, [driver.driver_id]
        );
        res.render('driver/trips', {
            user: req.session.user, driver, trips,
            error: req.flash('error'), success: req.flash('success')
        });
    } catch (err) {
        res.render('driver/trips', {
            user: req.session.user, driver: null, trips: [],
            error: 'Failed to load trips.', success: null
        });
    }
});

// ── EARNINGS ──────────────────────────────────────────────────
router.get('/earnings', guard, async (req, res) => {
    const uid = req.session.user.user_id;
    try {
        const [[driver]] = await db.query('SELECT * FROM drivers WHERE user_id = ?', [uid]);
        const [[wallet]] = await db.query('SELECT * FROM wallet  WHERE user_id = ?', [uid]);
        const [[totals]] = await db.query(
            `SELECT SUM(gross_amount) AS total_gross,
                    SUM(commission)   AS total_commission,
                    SUM(net_amount)   AS total_net,
                    COUNT(*)          AS total_rides
             FROM driver_earnings WHERE driver_id = ?`, [driver.driver_id]
        );
        const [earnings] = await db.query(
            `SELECT de.*, r.created_at AS ride_date, pl.city AS city
             FROM driver_earnings de
             JOIN rides     r  ON de.ride_id           = r.ride_id
             JOIN locations pl ON r.pickup_location_id = pl.location_id
             WHERE de.driver_id = ?
             ORDER BY de.earned_at DESC`, [driver.driver_id]
        );
        res.render('driver/earnings', {
            user: req.session.user, driver, wallet, totals, earnings,
            error: req.flash('error'), success: req.flash('success')
        });
    } catch (err) {
        res.render('driver/earnings', {
            user: req.session.user, driver: null, wallet: null,
            totals: null, earnings: [], error: 'Failed to load.', success: null
        });
    }
});

// ── DRIVER PAYOUTS ────────────────────────────────────────────
router.get('/payouts', guard, async (req, res) => {
    const uid = req.session.user.user_id;
    try {
        const [[driver]] = await db.query('SELECT * FROM drivers WHERE user_id = ?', [uid]);
        const [[wallet]] = await db.query('SELECT * FROM wallet WHERE user_id = ?', [uid]);
        const [[totals]] = await db.query(
            `SELECT SUM(gross_amount) AS total_gross,
                    SUM(commission)   AS total_commission,
                    SUM(net_amount)   AS total_net,
                    COUNT(*)          AS total_rides
             FROM driver_earnings WHERE driver_id = ?`, [driver.driver_id]
        );
        const [[pendingSummary]] = await db.query(
            `SELECT COUNT(*) AS pending_count, SUM(net_amount) AS pending_total
             FROM driver_earnings
             WHERE driver_id = ? AND payout_status = 'pending'`, [driver.driver_id]
        );
        const [earnings] = await db.query(
            `SELECT de.*, r.created_at AS ride_date, pl.city AS city
             FROM driver_earnings de
             JOIN rides r ON de.ride_id = r.ride_id
             JOIN locations pl ON r.pickup_location_id = pl.location_id
             WHERE de.driver_id = ?
             ORDER BY de.earned_at DESC`, [driver.driver_id]
        );
        res.render('driver/payouts', {
            user: req.session.user, driver, wallet, totals, pendingSummary, earnings,
            error: req.flash('error'), success: req.flash('success')
        });
    } catch (err) {
        res.render('driver/payouts', {
            user: req.session.user, driver: null, wallet: null,
            totals: null, pendingSummary: null, earnings: [],
            error: 'Unable to load payouts.', success: null
        });
    }
});

// ── REQUEST PAYOUT ────────────────────────────────────────────
router.post('/payout', guard, async (req, res) => {
    const uid = req.session.user.user_id;
    try {
        const [[wallet]] = await db.query('SELECT * FROM wallet WHERE user_id = ?', [uid]);
        if (!wallet || wallet.balance <= 0) {
            req.flash('error', 'No balance available for payout.');
            return res.redirect('/driver/earnings');
        }
        await db.query(
            `UPDATE wallet SET payout_status = 'pending', last_payout_date = NOW()
             WHERE user_id = ?`, [uid]
        );
        req.flash('success', 'Payout requested! Admin will process within 24 hours.');
        res.redirect('/driver/payouts');
    } catch (err) {
        req.flash('error', 'Payout request failed.');
        res.redirect('/driver/payouts');
    }
});

module.exports = router;