// Ensure user is logged in
exports.isAuthenticated = (req, res, next) => {
    if (req.session && req.session.user) return next();
    req.flash('error', 'Please login to continue.');
    res.redirect('/auth/login');
};

// Role guard factory
exports.hasRole = (...roles) => (req, res, next) => {
    if (req.session && req.session.user && roles.includes(req.session.user.role)) {
        return next();
    }
    res.status(403).render('403', { user: req.session.user || null });
};
