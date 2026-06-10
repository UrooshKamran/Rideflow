-- =============================================================

USE defaultdb;

-- =============================================================
-- SECTION 1: VIEWS
-- =============================================================

-- View of active rides with rider, driver, and vehicle details.
CREATE OR REPLACE VIEW ActiveRidesView AS
SELECT
    r.ride_id,
    r.status,
    r.fare,
    r.created_at,
    ur.full_name  AS rider_name,
    ur.phone      AS rider_phone,
    ud.full_name  AS driver_name,
    ud.phone      AS driver_phone,
    d.avg_rating  AS driver_rating,
    v.make, v.model, v.license_plate, v.vehicle_type,
    pl.address    AS pickup_address,
    pl.city       AS pickup_city,
    dl.address    AS dropoff_address
FROM rides r
JOIN users     ur ON r.rider_id             = ur.user_id
LEFT JOIN drivers  d  ON r.driver_id        = d.driver_id
LEFT JOIN users    ud ON d.user_id          = ud.user_id
LEFT JOIN vehicles v  ON r.vehicle_id       = v.vehicle_id
JOIN locations     pl ON r.pickup_location_id  = pl.location_id
JOIN locations     dl ON r.dropoff_location_id = dl.location_id
WHERE r.status IN ('requested','accepted','driver_en_route','in_progress');

-- View of the top-rated drivers with average rating above 4.5.
CREATE OR REPLACE VIEW TopDriversView AS
SELECT
    d.driver_id,
    u.full_name,
    u.email,
    u.phone,
    d.avg_rating,
    d.total_trips,
    d.avail_status,
    d.verify_status
FROM drivers d
JOIN users u ON d.user_id = u.user_id
WHERE d.avg_rating > 4.5
ORDER BY d.avg_rating DESC;

-- Full trip report view using joins across riders, drivers, payments, and promo codes.
CREATE OR REPLACE VIEW FullTripReportView AS
SELECT
    r.ride_id,
    r.status,
    r.fare,
    r.distance,
    r.duration,
    r.created_at,
    r.completed_at,
    ur.full_name  AS rider_name,
    ur.email      AS rider_email,
    ud.full_name  AS driver_name,
    d.avg_rating  AS driver_rating,
    v.make, v.model, v.vehicle_type,
    pl.address    AS pickup_address,
    pl.city,
    dl.address    AS dropoff_address,
    p.amount      AS payment_amount,
    p.pay_method,
    p.pay_status,
    p.discount_appld,
    pc.code       AS promo_code
FROM rides r
JOIN users     ur ON r.rider_id              = ur.user_id
LEFT JOIN drivers  d  ON r.driver_id         = d.driver_id
LEFT JOIN users    ud ON d.user_id           = ud.user_id
LEFT JOIN vehicles v  ON r.vehicle_id        = v.vehicle_id
JOIN locations     pl ON r.pickup_location_id  = pl.location_id
JOIN locations     dl ON r.dropoff_location_id = dl.location_id
LEFT JOIN payments   p  ON r.ride_id         = p.ride_id
LEFT JOIN promo_codes pc ON p.promo_id       = pc.promo_id;

-- Revenue by city view
CREATE OR REPLACE VIEW RevenueByCityView AS
SELECT
    l.city,
    COUNT(r.ride_id)  AS total_rides,
    SUM(p.amount)     AS total_revenue,
    AVG(p.amount)     AS avg_fare
FROM payments p
JOIN rides     r ON p.ride_id            = r.ride_id
JOIN locations l ON r.pickup_location_id = l.location_id
WHERE p.pay_status = 'paid'
GROUP BY l.city;

-- =============================================================
-- SECTION 2: STORED PROCEDURES
-- =============================================================

DELIMITER $$

-- CalculateFare: calculates fare using base + distance + duration + surge
-- Called when a driver marks a ride complete
CREATE PROCEDURE CalculateFare(
    IN  p_ride_id   INT UNSIGNED,
    IN  p_distance  DECIMAL(8,2),
    IN  p_duration  INT UNSIGNED
)
BEGIN
    DECLARE v_base_rate     DECIMAL(8,2)  DEFAULT 50.00;
    DECLARE v_per_km_rate   DECIMAL(8,2)  DEFAULT 20.00;
    DECLARE v_per_min_rate  DECIMAL(8,2)  DEFAULT 2.00;
    DECLARE v_surge_multi   DECIMAL(4,2)  DEFAULT 1.00;
    DECLARE v_rule_id       INT UNSIGNED;
    DECLARE v_fare          DECIMAL(10,2);
    DECLARE v_commission    DECIMAL(10,2);
    DECLARE v_net           DECIMAL(10,2);
    DECLARE v_driver_id     INT UNSIGNED;
    DECLARE v_rider_id      INT UNSIGNED;

    -- Get ride info
    SELECT rule_id, driver_id, rider_id
    INTO v_rule_id, v_driver_id, v_rider_id
    FROM rides WHERE ride_id = p_ride_id;

    -- Get fare rule if exists
    IF v_rule_id IS NOT NULL THEN
        SELECT base_rate, per_km_rate, per_min_rate, surge_multi
        INTO v_base_rate, v_per_km_rate, v_per_min_rate, v_surge_multi
        FROM fare_rules WHERE rule_id = v_rule_id;
    END IF;

    -- Calculate fare: (base + km*distance + min*duration) * surge
    SET v_fare       = (v_base_rate + (v_per_km_rate * p_distance) + (v_per_min_rate * p_duration)) * v_surge_multi;
    SET v_commission = ROUND(v_fare * 0.20, 2);   -- 20% platform commission
    SET v_net        = ROUND(v_fare - v_commission, 2);

    -- Update ride fare
    UPDATE rides SET fare = v_fare, distance = p_distance, duration = p_duration
    WHERE ride_id = p_ride_id;

    -- Insert earnings record
    INSERT INTO driver_earnings (ride_id, driver_id, gross_amount, commission, net_amount)
    VALUES (p_ride_id, v_driver_id, v_fare, v_commission, v_net)
    ON DUPLICATE KEY UPDATE
        gross_amount = v_fare,
        commission   = v_commission,
        net_amount   = v_net;

    -- Credit driver wallet
    UPDATE wallet SET balance = balance + v_net
    WHERE user_id = (SELECT user_id FROM drivers WHERE driver_id = v_driver_id);

    -- Insert payment record
    INSERT INTO payments (ride_id, rider_id, amount, pay_method, pay_status)
    VALUES (p_ride_id, v_rider_id, v_fare, 'cash', 'pending')
    ON DUPLICATE KEY UPDATE amount = v_fare;

END$$

-- GetDriverStats: returns summary stats for a driver
CREATE PROCEDURE GetDriverStats(IN p_driver_id INT UNSIGNED)
BEGIN
    SELECT
        d.driver_id,
        u.full_name,
        d.avg_rating,
        d.total_trips,
        SUM(de.gross_amount) AS total_earned,
        SUM(de.commission)   AS total_commission,
        SUM(de.net_amount)   AS total_net
    FROM drivers d
    JOIN users          u  ON d.user_id   = u.user_id
    LEFT JOIN driver_earnings de ON d.driver_id = de.driver_id
    WHERE d.driver_id = p_driver_id
    GROUP BY d.driver_id;
END$$

-- AssignNextDriver: assigns the next available verified driver for the ride
CREATE PROCEDURE AssignNextDriver(
    IN p_ride_id INT UNSIGNED,
    IN p_excluded_driver INT UNSIGNED,
    IN p_vehicle_type VARCHAR(20)
)
BEGIN
    DECLARE v_driver_id  INT UNSIGNED;
    DECLARE v_vehicle_id INT UNSIGNED;
    DECLARE done         BOOLEAN DEFAULT FALSE;

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    SELECT d.driver_id, v.vehicle_id
    INTO v_driver_id, v_vehicle_id
    FROM drivers d
    JOIN vehicles v ON d.driver_id = v.driver_id
    WHERE d.avail_status = 'online'
      AND d.verify_status = 'verified'
      AND v.verify_status = 'verified'
      AND v.vehicle_type = p_vehicle_type
      AND (p_excluded_driver IS NULL OR d.driver_id <> p_excluded_driver)
    LIMIT 1;

    IF NOT done AND v_driver_id IS NOT NULL THEN
        UPDATE rides
        SET driver_id = v_driver_id,
            vehicle_id = v_vehicle_id
        WHERE ride_id = p_ride_id
          AND status = 'requested';
    END IF;
END$$

DELIMITER ;

-- =============================================================
-- SECTION 3: TRIGGERS
-- =============================================================

DELIMITER $$

-- T1: Prevent pickup = dropoff (MySQL FK limitation workaround)
CREATE TRIGGER trg_rides_location_check
BEFORE INSERT ON rides
FOR EACH ROW
BEGIN
    IF NEW.pickup_location_id = NEW.dropoff_location_id THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Pickup and dropoff locations cannot be the same.';
    END IF;
END$$

-- When payment is marked paid, mark the ride completed and archive it.
CREATE TRIGGER trg_payment_complete_ride
AFTER UPDATE ON payments
FOR EACH ROW
BEGIN
    IF NEW.pay_status = 'paid' AND OLD.pay_status != 'paid' THEN
        UPDATE rides
        SET status       = 'completed',
            completed_at = NOW()
        WHERE ride_id = NEW.ride_id
        AND   status NOT IN ('completed','cancelled');

        -- Archive to ride_history
        INSERT IGNORE INTO ride_history (ride_id, outcome, final_fare)
        SELECT ride_id, 'completed', fare FROM rides WHERE ride_id = NEW.ride_id;
    END IF;
END$$

-- After a new rating is added, update driver average and flag low-rated drivers.
CREATE TRIGGER trg_flag_low_rated_driver
AFTER INSERT ON ratings
FOR EACH ROW
BEGIN
    DECLARE v_driver_id   INT UNSIGNED;
    DECLARE v_avg         DECIMAL(3,2);
    DECLARE v_user_id     INT UNSIGNED;
    DECLARE v_driver_name VARCHAR(100);
    DECLARE v_msg         TEXT;

    -- Get driver_id and user_id of the rated person
    SELECT d.driver_id, d.user_id INTO v_driver_id, v_user_id
    FROM drivers d
    WHERE d.user_id = NEW.rated_user_id
    LIMIT 1;

    IF v_driver_id IS NOT NULL THEN
        -- Recalculate avg rating from all ratings
        SELECT ROUND(AVG(score), 2) INTO v_avg
        FROM ratings
        WHERE rated_user_id = NEW.rated_user_id;

        -- Update driver avg_rating
        UPDATE drivers SET avg_rating = v_avg WHERE driver_id = v_driver_id;

        -- Flag if below 3.5
        IF v_avg < 3.5 THEN
            -- Suspend driver account
            UPDATE users SET acc_status = 'suspended'
            WHERE user_id = v_user_id;

            -- Get driver name for notification message
            SELECT full_name INTO v_driver_name
            FROM users WHERE user_id = v_user_id;

            -- Build notification message
            SET v_msg = CONCAT(
                'ALERT: Driver "', v_driver_name,
                '" (driver_id=', v_driver_id,
                ') has been auto-suspended. Average rating dropped to ',
                v_avg, ' (below 3.5). Please review.'
            );

            -- Insert admin notification
            INSERT INTO admin_notifications (type, message, related_user_id)
            VALUES ('low_rating_flag', v_msg, v_user_id);
        END IF;
    END IF;
END$$

-- Increment promo usage count when a promo code is applied to payment.
CREATE TRIGGER trg_promo_usage_increment
AFTER INSERT ON payments
FOR EACH ROW
BEGIN
    IF NEW.promo_id IS NOT NULL THEN
        UPDATE promo_codes
        SET usage_count = usage_count + 1
        WHERE promo_id = NEW.promo_id;
    END IF;
END$$

CREATE TRIGGER trg_promo_usage_increment_update
AFTER UPDATE ON payments
FOR EACH ROW
BEGIN
    IF NEW.promo_id IS NOT NULL AND OLD.promo_id IS NULL THEN
        UPDATE promo_codes
        SET usage_count = usage_count + 1
        WHERE promo_id = NEW.promo_id;
    END IF;
END$$

-- T5: Prevent self-rating
CREATE TRIGGER trg_ratings_self_check
BEFORE INSERT ON ratings
FOR EACH ROW
BEGIN
    IF NEW.rated_by = NEW.rated_user_id THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'A user cannot rate themselves.';
    END IF;
END$$

-- T6: Prevent self-complaint
CREATE TRIGGER trg_complaints_self_check
BEFORE INSERT ON complaints
FOR EACH ROW
BEGIN
    IF NEW.filed_by = NEW.against_user_id THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'A user cannot file a complaint against themselves.';
    END IF;
END$$

-- T7: Archive ride when cancelled
CREATE TRIGGER trg_archive_cancelled_ride
AFTER UPDATE ON rides
FOR EACH ROW
BEGIN
    IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' THEN
        INSERT IGNORE INTO ride_history (ride_id, outcome, final_fare)
        VALUES (NEW.ride_id, 'cancelled', COALESCE(NEW.fare, 0));
    END IF;
END$$

CREATE TRIGGER trg_update_driver_trip_count
AFTER UPDATE ON rides
FOR EACH ROW
BEGIN
    IF NEW.status = 'completed' AND OLD.status != 'completed' AND NEW.driver_id IS NOT NULL THEN
        UPDATE drivers
        SET total_trips = total_trips + 1
        WHERE driver_id = NEW.driver_id;
    END IF;
END$$

DELIMITER ;

-- =============================================================
--  EVENT SCHEDULER
-- =============================================================



-- Nightly event to expire promo codes after their valid_until date.
CREATE EVENT IF NOT EXISTS evt_expire_promo_codes
ON SCHEDULE EVERY 1 DAY
STARTS (DATE(NOW()) + INTERVAL 1 DAY)
DO
    UPDATE promo_codes
    SET usage_limit = usage_count   -- effectively disables it
    WHERE valid_until < NOW()
    AND   usage_count < usage_limit;

-- =============================================================
-- SECTION 5: Role-based access control and database users.
-- =============================================================

-- Create roles
CREATE USER IF NOT EXISTS 'rider_role'@'%'    IDENTIFIED BY 'rider_pass_2026';
CREATE USER IF NOT EXISTS 'driver_role'@'%'   IDENTIFIED BY 'driver_pass_2026';
CREATE USER IF NOT EXISTS 'support_role'@'%'  IDENTIFIED BY 'support_pass_2026';
CREATE USER IF NOT EXISTS 'admin_role'@'%'    IDENTIFIED BY 'admin_pass_2026';

-- rider_role: can INSERT rides and payments, SELECT own data
GRANT SELECT, INSERT ON defaultdb.rides    TO 'rider_role'@'%';
GRANT SELECT, INSERT ON defaultdb.payments TO 'rider_role'@'%';
GRANT SELECT          ON defaultdb.locations    TO 'rider_role'@'%';
GRANT SELECT          ON defaultdb.promo_codes  TO 'rider_role'@'%';
GRANT SELECT          ON defaultdb.ratings      TO 'rider_role'@'%';
GRANT INSERT          ON defaultdb.ratings      TO 'rider_role'@'%';

-- driver_role: can SELECT rides, update status, view earnings
GRANT SELECT          ON defaultdb.rides          TO 'driver_role'@'%';
GRANT UPDATE          ON defaultdb.rides          TO 'driver_role'@'%';
GRANT SELECT          ON defaultdb.driver_earnings TO 'driver_role'@'%';
GRANT SELECT, UPDATE  ON defaultdb.drivers        TO 'driver_role'@'%';
GRANT SELECT          ON defaultdb.vehicles       TO 'driver_role'@'%';

-- support_role: can SELECT all but cannot DELETE
GRANT SELECT ON defaultdb.users           TO 'support_role'@'%';
GRANT SELECT ON defaultdb.rides           TO 'support_role'@'%';
GRANT SELECT ON defaultdb.payments        TO 'support_role'@'%';
GRANT SELECT ON defaultdb.complaints      TO 'support_role'@'%';
REVOKE DELETE ON defaultdb.rides     FROM 'support_role'@'%';
REVOKE DELETE ON defaultdb.payments  FROM 'support_role'@'%';

-- admin_role: full privileges
GRANT ALL PRIVILEGES ON defaultdb.* TO 'admin_role'@'%';

FLUSH PRIVILEGES;

-- =============================================================
-- SECTION 6: Example queries for reporting and validation.
-- =============================================================

-- Q1: All completed rides for a specific rider ordered by date
-- (Replace 1 with actual rider user_id)
SELECT
    r.ride_id,
    r.fare,
    r.distance,
    r.duration,
    r.completed_at,
    pl.address AS pickup,
    dl.address AS dropoff
FROM rides r
JOIN locations pl ON r.pickup_location_id  = pl.location_id
JOIN locations dl ON r.dropoff_location_id = dl.location_id
WHERE r.rider_id = 1
  AND r.status   = 'completed'
ORDER BY r.completed_at DESC;

-- Q2: All drivers in a city ordered by rating
SELECT
    u.full_name,
    u.phone,
    d.avg_rating,
    d.total_trips,
    d.avail_status
FROM drivers d
JOIN users u ON d.user_id = u.user_id
WHERE d.driver_id IN (
    SELECT DISTINCT r.driver_id
    FROM rides r
    JOIN locations l ON r.pickup_location_id = l.location_id
    WHERE l.city = 'Karachi'
)
ORDER BY d.avg_rating DESC;

-- Q3: Total revenue per city (SUM + GROUP BY)
SELECT
    l.city,
    SUM(p.amount)  AS total_revenue,
    COUNT(r.ride_id) AS total_rides
FROM payments p
JOIN rides     r ON p.ride_id            = r.ride_id
JOIN locations l ON r.pickup_location_id = l.location_id
WHERE p.pay_status = 'paid'
GROUP BY l.city
ORDER BY total_revenue DESC;

-- Q4: Find drivers whose average rating is below 3.5.
SELECT
    u.full_name,
    d.driver_id,
    AVG(rt.score) AS avg_score,
    COUNT(rt.rating_id) AS total_ratings
FROM ratings rt
JOIN users   u ON rt.rated_user_id = u.user_id
JOIN drivers d ON u.user_id        = d.user_id
GROUP BY rt.rated_user_id
HAVING AVG(rt.score) < 3.5
ORDER BY avg_score ASC;

-- Q5: Trips completed per driver (COUNT + GROUP BY)
SELECT
    u.full_name,
    COUNT(r.ride_id) AS completed_trips
FROM rides r
JOIN drivers d ON r.driver_id = d.driver_id
JOIN users   u ON d.user_id   = u.user_id
WHERE r.status = 'completed'
GROUP BY r.driver_id
ORDER BY completed_trips DESC;

-- Q6: LEFT JOIN - all riders including those with no rides
SELECT
    u.user_id,
    u.full_name,
    u.email,
    COUNT(r.ride_id) AS total_rides
FROM users u
LEFT JOIN rides r ON u.user_id = r.rider_id
WHERE u.role = 'rider'
GROUP BY u.user_id
ORDER BY total_rides DESC;

-- Q7: Payment history with associated promo code details.
SELECT
    r.ride_id,
    ur.full_name  AS rider_name,
    p.amount,
    p.pay_method,
    p.discount_appld,
    pc.code       AS promo_code,
    pc.discount_pct
FROM payments p
JOIN rides       r  ON p.ride_id   = r.ride_id
JOIN users       ur ON r.rider_id  = ur.user_id
LEFT JOIN promo_codes pc ON p.promo_id = pc.promo_id
ORDER BY p.transaction_date DESC;