// =============================================================
//  RideFlow — Server-side Validation Middleware
//  middleware/validate.js
// =============================================================

// ── Helpers ───────────────────────────────────────────────────
const isValidEmail = (email) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const isValidPhone = (phone) =>
    /^03[0-9]{9}$/.test(phone.replace(/[-\s]/g, ''));

const isValidCNIC = (cnic) =>
    /^\d{5}-\d{7}-\d{1}$/.test(cnic) || /^\d{13}$/.test(cnic.replace(/-/g, ''));

const isValidPassword = (password) =>
    password && password.length >= 6;

const isValidLicensePlate = (plate) =>
    /^[A-Z]{2,4}[-\s]?\d{3,4}$/.test(plate.toUpperCase().replace(/\s/g, '-'));

// ── Register Validation ───────────────────────────────────────
exports.validateRegister = (req, res, next) => {
    const { full_name, email, phone, password, role, cnic, license_num } = req.body;
    const errors = [];

    if (!full_name || full_name.trim().length < 3)
        errors.push('Full name must be at least 3 characters.');

    if (!email || !isValidEmail(email))
        errors.push('Please enter a valid email address.');

    if (!phone || !isValidPhone(phone))
        errors.push('Phone must be a valid Pakistani number (e.g. 03001234567).');

    if (!isValidPassword(password))
        errors.push('Password must be at least 6 characters long.');

    if (!['rider', 'driver'].includes(role))
        errors.push('Invalid role selected.');

    if (role === 'driver') {
        if (!cnic || !isValidCNIC(cnic))
            errors.push('CNIC must be in format: 42201-1234567-1');
        if (!license_num || license_num.trim().length < 5)
            errors.push('License number must be at least 5 characters.');
    }

    if (errors.length > 0) {
        req.flash('error', errors[0]);
        return res.redirect('/auth/register');
    }
    next();
};

// ── Book Ride Validation ──────────────────────────────────────
exports.validateBookRide = (req, res, next) => {
    const { pickup_address, pickup_city, dropoff_address,
            dropoff_city, vehicle_type, scheduled_at } = req.body;
    const errors = [];

    if (!pickup_address || pickup_address.trim().length < 3)
        errors.push('Please enter a valid pickup address.');

    if (!pickup_city || pickup_city.trim().length < 2)
        errors.push('Please enter a valid pickup city.');

    if (!dropoff_address || dropoff_address.trim().length < 3)
        errors.push('Please enter a valid dropoff address.');

    if (!dropoff_city || dropoff_city.trim().length < 2)
        errors.push('Please enter a valid dropoff city.');

    if (pickup_address.trim().toLowerCase() === dropoff_address.trim().toLowerCase() &&
        pickup_city.trim().toLowerCase() === dropoff_city.trim().toLowerCase())
        errors.push('Pickup and dropoff locations cannot be the same.');

    if (!['economy', 'premium', 'bike'].includes(vehicle_type))
        errors.push('Please select a valid vehicle type.');

    if (scheduled_at) {
        const schedDate = new Date(scheduled_at);
        if (schedDate <= new Date())
            errors.push('Scheduled time must be in the future.');
    }

    if (errors.length > 0) {
        req.flash('error', errors[0]);
        return res.redirect('/rider/book');
    }
    next();
};

// ── Complete Ride Validation ──────────────────────────────────
exports.validateCompleteRide = (req, res, next) => {
    const { distance, duration } = req.body;
    const errors = [];

    const dist = parseFloat(distance);
    const dur  = parseInt(duration);

    if (!distance || isNaN(dist) || dist <= 0)
        errors.push('Distance must be a positive number greater than 0.');

    if (dist > 500)
        errors.push('Distance cannot exceed 500 km.');

    if (!duration || isNaN(dur) || dur <= 0)
        errors.push('Duration must be a positive number greater than 0.');

    if (dur > 600)
        errors.push('Duration cannot exceed 600 minutes.');

    if (errors.length > 0) {
        req.flash('error', errors[0]);
        return res.redirect('/driver/dashboard');
    }
    next();
};

// ── Add Vehicle Validation ────────────────────────────────────
exports.validateAddVehicle = (req, res, next) => {
    const { make, model, year, color, license_plate, vehicle_type } = req.body;
    const errors = [];

    if (!make || make.trim().length < 2)
        errors.push('Vehicle make must be at least 2 characters.');

    if (!model || model.trim().length < 1)
        errors.push('Vehicle model is required.');

    const yr = parseInt(year);
    const currentYear = new Date().getFullYear();
    if (!year || isNaN(yr) || yr < 2000 || yr > currentYear)
        errors.push(`Vehicle year must be between 2000 and ${currentYear}.`);

    if (!color || color.trim().length < 2)
        errors.push('Vehicle color is required.');

    if (!license_plate || license_plate.trim().length < 4)
        errors.push('Please enter a valid license plate.');

    if (!['economy', 'premium', 'bike'].includes(vehicle_type))
        errors.push('Please select a valid vehicle type.');

    if (errors.length > 0) {
        req.flash('error', errors[0]);
        return res.redirect('/driver/vehicles/add');
    }
    next();
};

// ── Wallet Top Up Validation ──────────────────────────────────
exports.validateTopup = (req, res, next) => {
    const { amount } = req.body;
    const amt = parseFloat(amount);

    if (!amount || isNaN(amt))
        { req.flash('error', 'Please enter a valid amount.'); return res.redirect('/rider/wallet'); }

    if (amt < 100)
        { req.flash('error', 'Minimum top up amount is Rs. 100.'); return res.redirect('/rider/wallet'); }

    if (amt > 50000)
        { req.flash('error', 'Maximum top up amount is Rs. 50,000.'); return res.redirect('/rider/wallet'); }

    next();
};

// ── Fare Rule Validation ──────────────────────────────────────
exports.validateFareRule = (req, res, next) => {
    const { city, vehicle_type, base_rate, per_km_rate, per_min_rate, surge_multi } = req.body;
    const errors = [];

    if (!city || city.trim().length < 2)
        errors.push('City name must be at least 2 characters.');

    if (!['economy', 'premium', 'bike'].includes(vehicle_type))
        errors.push('Please select a valid vehicle type.');

    if (!base_rate || parseFloat(base_rate) <= 0)
        errors.push('Base rate must be greater than 0.');

    if (!per_km_rate || parseFloat(per_km_rate) <= 0)
        errors.push('Per KM rate must be greater than 0.');

    if (!per_min_rate || parseFloat(per_min_rate) <= 0)
        errors.push('Per minute rate must be greater than 0.');

    if (surge_multi && parseFloat(surge_multi) < 1.0)
        errors.push('Surge multiplier cannot be less than 1.0.');

    if (errors.length > 0) {
        req.flash('error', errors[0]);
        return res.redirect('/admin/fare-rules');
    }
    next();
};

// ── Promo Code Validation ─────────────────────────────────────
exports.validatePromo = (req, res, next) => {
    const { code, discount_pct, usage_limit, valid_from, valid_until } = req.body;
    const errors = [];

    if (!code || code.trim().length < 3)
        errors.push('Promo code must be at least 3 characters.');

    if (!/^[A-Z0-9]+$/i.test(code.trim()))
        errors.push('Promo code can only contain letters and numbers.');

    const pct = parseFloat(discount_pct);
    if (!discount_pct || isNaN(pct) || pct < 1 || pct > 100)
        errors.push('Discount must be between 1% and 100%.');

    const limit = parseInt(usage_limit);
    if (!usage_limit || isNaN(limit) || limit < 1)
        errors.push('Usage limit must be at least 1.');

    if (!valid_from)
        errors.push('Valid from date is required.');

    if (!valid_until)
        errors.push('Valid until date is required.');

    if (valid_from && valid_until && new Date(valid_until) <= new Date(valid_from))
        errors.push('Valid until date must be after valid from date.');

    if (errors.length > 0) {
        req.flash('error', errors[0]);
        return res.redirect('/admin/promos');
    }
    next();
};

// ── Rating Validation ─────────────────────────────────────────
exports.validateRating = (req, res, next) => {
    const { score, rated_user_id } = req.body;
    const s = parseInt(score);

    if (!score || isNaN(s) || s < 1 || s > 5)
        { req.flash('error', 'Rating score must be between 1 and 5.'); return res.redirect('back'); }

    if (!rated_user_id)
        { req.flash('error', 'Invalid rating target.'); return res.redirect('back'); }

    next();
};