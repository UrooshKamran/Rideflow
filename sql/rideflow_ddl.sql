DROP DATABASE IF EXISTS defaultdb;
CREATE DATABASE defaultdb
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE defaultdb;

-- =============================================================
-- Users table stores account details for riders, drivers, and admins.
-- =============================================================
CREATE TABLE users (
    user_id           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    full_name         VARCHAR(100)  NOT NULL,
    email             VARCHAR(150)  NOT NULL,
    phone             VARCHAR(20)   NOT NULL,
    password_hash     VARCHAR(255)  NOT NULL,
    role              ENUM('super_admin','admin','rider','driver')
                                    NOT NULL DEFAULT 'rider',
    acc_status        ENUM('active','suspended','banned')
                                    NOT NULL DEFAULT 'active',
    registration_date DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_users        PRIMARY KEY (user_id),
    CONSTRAINT uq_users_email  UNIQUE (email),
    CONSTRAINT uq_users_phone  UNIQUE (phone)
);

-- =============================================================
-- Drivers table stores driver verification, availability, and performance data.
-- =============================================================
CREATE TABLE drivers (
    driver_id      INT UNSIGNED   NOT NULL AUTO_INCREMENT,
    user_id        INT UNSIGNED   NOT NULL,
    cnic           VARCHAR(20)    NOT NULL,
    license_num    VARCHAR(50)    NOT NULL,
    profile_photo  VARCHAR(500)   NULL,
    verify_status  ENUM('pending','verified','rejected')
                                  NOT NULL DEFAULT 'pending',
    avail_status   ENUM('online','offline','on_trip')
                                  NOT NULL DEFAULT 'offline',
    avg_rating     DECIMAL(3,2)   NOT NULL DEFAULT 0.00,
    total_trips    INT UNSIGNED   NOT NULL DEFAULT 0,

    CONSTRAINT pk_drivers             PRIMARY KEY (driver_id),
    CONSTRAINT uq_drivers_user_id     UNIQUE (user_id),
    CONSTRAINT uq_drivers_cnic        UNIQUE (cnic),
    CONSTRAINT uq_drivers_license     UNIQUE (license_num),
    CONSTRAINT fk_drivers_user        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT chk_drivers_avg_rating CHECK (avg_rating BETWEEN 0.00 AND 5.00)
);

-- =============================================================
-- Vehicles table keeps registered vehicle details for each driver.
-- =============================================================
CREATE TABLE vehicles (
    vehicle_id     INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    driver_id      INT UNSIGNED  NOT NULL,
    make           VARCHAR(50)   NOT NULL,
    model          VARCHAR(50)   NOT NULL,
    year           YEAR          NOT NULL,
    color          VARCHAR(30)   NOT NULL,
    license_plate  VARCHAR(20)   NOT NULL,
    vehicle_type   ENUM('economy','premium','bike')
                                 NOT NULL,
    verify_status  ENUM('pending','verified','rejected')
                                 NOT NULL DEFAULT 'pending',

    CONSTRAINT pk_vehicles               PRIMARY KEY (vehicle_id),
    CONSTRAINT uq_vehicles_license_plate UNIQUE (license_plate),
    CONSTRAINT fk_vehicles_driver        FOREIGN KEY (driver_id)
        REFERENCES drivers(driver_id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT chk_vehicles_year         CHECK (year >= 2000)
);

-- =============================================================
-- Locations table stores pickup and drop-off coordinates and city names.
-- =============================================================
CREATE TABLE locations (
    location_id  INT UNSIGNED   NOT NULL AUTO_INCREMENT,
    latitude     DECIMAL(10,7)  NOT NULL,
    longitude    DECIMAL(10,7)  NOT NULL,
    address      VARCHAR(300)   NULL,
    city         VARCHAR(100)   NOT NULL,

    CONSTRAINT pk_locations            PRIMARY KEY (location_id),
    CONSTRAINT chk_locations_latitude  CHECK (latitude  BETWEEN -90.0000000  AND  90.0000000),
    CONSTRAINT chk_locations_longitude CHECK (longitude BETWEEN -180.0000000 AND 180.0000000)
);

-- =============================================================
-- Fare rules define base fare, per-kilometer, per-minute, and surge pricing.
-- =============================================================
CREATE TABLE fare_rules (
    rule_id       INT UNSIGNED   NOT NULL AUTO_INCREMENT,
    city          VARCHAR(100)   NOT NULL,
    vehicle_type  ENUM('economy','premium','bike')
                                 NOT NULL,
    base_rate     DECIMAL(8,2)   NOT NULL,
    per_km_rate   DECIMAL(8,2)   NOT NULL,
    per_min_rate  DECIMAL(8,2)   NOT NULL,
    surge_multi   DECIMAL(4,2)   NOT NULL DEFAULT 1.00,

    CONSTRAINT pk_fare_rules            PRIMARY KEY (rule_id),
    CONSTRAINT uq_fare_rules_city_vtype UNIQUE (city, vehicle_type),
    CONSTRAINT chk_fare_rules_base      CHECK (base_rate    > 0),
    CONSTRAINT chk_fare_rules_km        CHECK (per_km_rate  > 0),
    CONSTRAINT chk_fare_rules_min       CHECK (per_min_rate > 0),
    CONSTRAINT chk_fare_rules_surge     CHECK (surge_multi  >= 1.00)
);

-- =============================================================
-- Promo codes provide discounts and track usage limits.
-- =============================================================
CREATE TABLE promo_codes (
    promo_id      INT UNSIGNED   NOT NULL AUTO_INCREMENT,
    code          VARCHAR(30)    NOT NULL,
    discount_pct  DECIMAL(5,2)   NOT NULL,
    usage_limit   INT UNSIGNED   NOT NULL DEFAULT 1,
    usage_count   INT UNSIGNED   NOT NULL DEFAULT 0,
    valid_from    DATETIME       NOT NULL,
    valid_until   DATETIME       NOT NULL,

    CONSTRAINT pk_promo_codes         PRIMARY KEY (promo_id),
    CONSTRAINT uq_promo_codes_code    UNIQUE (code),
    CONSTRAINT chk_promo_discount_pct CHECK (discount_pct BETWEEN 1.00 AND 100.00),
    CONSTRAINT chk_promo_usage        CHECK (usage_count <= usage_limit),
    CONSTRAINT chk_promo_valid_dates  CHECK (valid_until > valid_from)
);

-- =============================================================
-- Wallet account for riders and drivers stores balances and payout status.
-- =============================================================
CREATE TABLE wallet (
    wallet_id        INT UNSIGNED   NOT NULL AUTO_INCREMENT,
    user_id          INT UNSIGNED   NOT NULL,
    balance          DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
    last_payout_date DATETIME       NULL,
    payout_status    ENUM('none','pending','completed')
                                    NOT NULL DEFAULT 'none',

    CONSTRAINT pk_wallet          PRIMARY KEY (wallet_id),
    CONSTRAINT uq_wallet_user_id  UNIQUE (user_id),
    CONSTRAINT fk_wallet_user     FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT chk_wallet_balance CHECK (balance >= 0.00)
);

-- =============================================================
-- Rides table stores request, match, trip status, fare, and location references.
-- =============================================================
CREATE TABLE rides (
    ride_id              INT UNSIGNED   NOT NULL AUTO_INCREMENT,
    rider_id             INT UNSIGNED   NOT NULL,
    driver_id            INT UNSIGNED   NULL,
    vehicle_id           INT UNSIGNED   NULL,
    pickup_location_id   INT UNSIGNED   NOT NULL,
    dropoff_location_id  INT UNSIGNED   NOT NULL,
    rule_id              INT UNSIGNED   NULL,
    status               ENUM('requested','accepted','driver_en_route',
                              'in_progress','completed','cancelled')
                                        NOT NULL DEFAULT 'requested',
    fare                 DECIMAL(10,2)  NULL,
    distance             DECIMAL(8,2)   NULL    COMMENT 'in km',
    duration             INT UNSIGNED   NULL    COMMENT 'in minutes',
    scheduled_at         DATETIME       NULL,
    completed_at         DATETIME       NULL,
    created_at           DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_rides          PRIMARY KEY (ride_id),
    CONSTRAINT fk_rides_rider    FOREIGN KEY (rider_id)
        REFERENCES users(user_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_rides_driver   FOREIGN KEY (driver_id)
        REFERENCES drivers(driver_id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_rides_vehicle  FOREIGN KEY (vehicle_id)
        REFERENCES vehicles(vehicle_id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_rides_pickup   FOREIGN KEY (pickup_location_id)
        REFERENCES locations(location_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_rides_dropoff  FOREIGN KEY (dropoff_location_id)
        REFERENCES locations(location_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_rides_rule     FOREIGN KEY (rule_id)
        REFERENCES fare_rules(rule_id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_rides_fare     CHECK (fare     IS NULL OR fare     >= 0),
    CONSTRAINT chk_rides_distance CHECK (distance IS NULL OR distance >  0),
    CONSTRAINT chk_rides_duration CHECK (duration IS NULL OR duration >  0)
    -- pickup_location_id <> dropoff_location_id: see trigger trg_rides_location_check
);

-- =============================================================
-- Payments table records transaction details and promo discounts per ride.
-- =============================================================
CREATE TABLE payments (
    payment_id       INT UNSIGNED   NOT NULL AUTO_INCREMENT,
    ride_id          INT UNSIGNED   NOT NULL,
    rider_id         INT UNSIGNED   NOT NULL,
    promo_id         INT UNSIGNED   NULL,
    amount           DECIMAL(10,2)  NOT NULL,
    pay_method       ENUM('cash','wallet','card')
                                    NOT NULL,
    pay_status       ENUM('pending','paid','failed','refunded')
                                    NOT NULL DEFAULT 'pending',
    discount_appld   DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
    transaction_date DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_payments           PRIMARY KEY (payment_id),
    CONSTRAINT uq_payments_ride_id   UNIQUE (ride_id),
    CONSTRAINT fk_payments_ride      FOREIGN KEY (ride_id)
        REFERENCES rides(ride_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_payments_rider     FOREIGN KEY (rider_id)
        REFERENCES users(user_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_payments_promo     FOREIGN KEY (promo_id)
        REFERENCES promo_codes(promo_id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_payments_amount   CHECK (amount        >= 0),
    CONSTRAINT chk_payments_discount CHECK (discount_appld >= 0)
);

-- =============================================================
-- Driver earnings store platform commission and net payout amounts.
-- =============================================================
CREATE TABLE driver_earnings (
    earning_id    INT UNSIGNED   NOT NULL AUTO_INCREMENT,
    ride_id       INT UNSIGNED   NOT NULL,
    driver_id     INT UNSIGNED   NOT NULL,
    gross_amount  DECIMAL(10,2)  NOT NULL,
    commission    DECIMAL(10,2)  NOT NULL,
    net_amount    DECIMAL(10,2)  NOT NULL,
    payout_status ENUM('pending','paid')
                                 NOT NULL DEFAULT 'pending',
    earned_at     DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_driver_earnings        PRIMARY KEY (earning_id),
    CONSTRAINT uq_driver_earnings_ride   UNIQUE (ride_id),
    CONSTRAINT fk_driver_earnings_ride   FOREIGN KEY (ride_id)
        REFERENCES rides(ride_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_driver_earnings_driver FOREIGN KEY (driver_id)
        REFERENCES drivers(driver_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_earnings_gross        CHECK (gross_amount >= 0),
    CONSTRAINT chk_earnings_commission   CHECK (commission   >= 0),
    CONSTRAINT chk_earnings_net          CHECK (net_amount   >= 0),
    CONSTRAINT chk_earnings_net_vs_gross CHECK (net_amount   <= gross_amount)
);

-- =============================================================
-- Ratings table stores mutual feedback after each trip.
-- =============================================================
CREATE TABLE ratings (
    rating_id      INT UNSIGNED           NOT NULL AUTO_INCREMENT,
    ride_id        INT UNSIGNED           NOT NULL,
    rated_by       INT UNSIGNED           NOT NULL COMMENT 'user_id of person giving rating',
    rated_user_id  INT UNSIGNED           NOT NULL COMMENT 'user_id of person being rated',
    rater_role     ENUM('rider','driver')  NOT NULL,
    score          TINYINT UNSIGNED        NOT NULL,
    comment        TEXT                    NULL,
    rated_at       DATETIME                NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_ratings            PRIMARY KEY (rating_id),
    CONSTRAINT uq_ratings_ride_rater UNIQUE (ride_id, rated_by),
    CONSTRAINT fk_ratings_ride       FOREIGN KEY (ride_id)
        REFERENCES rides(ride_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_ratings_rated_by   FOREIGN KEY (rated_by)
        REFERENCES users(user_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_ratings_rated_user FOREIGN KEY (rated_user_id)
        REFERENCES users(user_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_ratings_score     CHECK (score BETWEEN 1 AND 5)
    -- rated_by <> rated_user_id: see trigger trg_ratings_self_check
);

-- =============================================================
-- Complaints track issues filed by riders or drivers for a ride.
-- =============================================================
CREATE TABLE complaints (
    complaint_id     INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    ride_id          INT UNSIGNED  NOT NULL,
    filed_by         INT UNSIGNED  NOT NULL COMMENT 'user_id of complainant',
    against_user_id  INT UNSIGNED  NOT NULL COMMENT 'user_id being complained about',
    subject          VARCHAR(200)  NOT NULL,
    description      TEXT          NOT NULL,
    status           ENUM('open','under_review','resolved','dismissed')
                                   NOT NULL DEFAULT 'open',
    filed_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at      DATETIME      NULL,

    CONSTRAINT pk_complaints              PRIMARY KEY (complaint_id),
    CONSTRAINT fk_complaints_ride         FOREIGN KEY (ride_id)
        REFERENCES rides(ride_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_complaints_filed_by     FOREIGN KEY (filed_by)
        REFERENCES users(user_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_complaints_against_user FOREIGN KEY (against_user_id)
        REFERENCES users(user_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_complaints_resolved    CHECK (
        resolved_at IS NULL OR resolved_at >= filed_at
    )
    -- filed_by <> against_user_id: see trigger trg_complaints_self_check
);

-- =============================================================
-- Ride history keeps an archive of completed and cancelled trips.
-- =============================================================
CREATE TABLE ride_history (
    history_id   INT UNSIGNED   NOT NULL AUTO_INCREMENT,
    ride_id      INT UNSIGNED   NOT NULL,
    outcome      ENUM('completed','cancelled')
                                NOT NULL,
    final_fare   DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
    archived_at  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_ride_history         PRIMARY KEY (history_id),
    CONSTRAINT uq_ride_history_ride_id UNIQUE (ride_id),
    CONSTRAINT fk_ride_history_ride    FOREIGN KEY (ride_id)
        REFERENCES rides(ride_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_ride_history_fare   CHECK (final_fare >= 0)
);

-- =============================================================
-- Admin notifications table stores system alerts for admin review.
-- =============================================================
CREATE TABLE admin_notifications (
    notification_id  INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    type             VARCHAR(50)   NOT NULL,
    message          TEXT          NOT NULL,
    related_user_id  INT UNSIGNED  NULL,
    is_read          TINYINT(1)    NOT NULL DEFAULT 0,
    created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_admin_notifications PRIMARY KEY (notification_id),
    CONSTRAINT fk_notif_user FOREIGN KEY (related_user_id)
        REFERENCES users(user_id)
        ON DELETE SET NULL ON UPDATE CASCADE
);

-- =============================================================
--  INDEXES
-- =============================================================
CREATE INDEX idx_rides_rider_id          ON rides(rider_id);
CREATE INDEX idx_rides_driver_id         ON rides(driver_id);
CREATE INDEX idx_rides_status            ON rides(status);
CREATE INDEX idx_rides_scheduled_at      ON rides(scheduled_at);
CREATE INDEX idx_payments_pay_status     ON payments(pay_status);
CREATE INDEX idx_earnings_driver_id      ON driver_earnings(driver_id);
CREATE INDEX idx_ratings_rated_user      ON ratings(rated_user_id);
CREATE INDEX idx_complaints_status       ON complaints(status);
CREATE INDEX idx_complaints_against_user ON complaints(against_user_id);
CREATE INDEX idx_drivers_avail_status    ON drivers(avail_status);
CREATE INDEX idx_vehicles_driver_id      ON vehicles(driver_id);
CREATE INDEX idx_promo_valid_until       ON promo_codes(valid_until);
CREATE INDEX idx_locations_city           ON locations(city);