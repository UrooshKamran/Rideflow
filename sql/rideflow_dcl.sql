

USE defaultdb;

DROP USER IF EXISTS 'super_admin'@'%';
DROP USER IF EXISTS 'admin_role'@'%';
DROP USER IF EXISTS 'driver_role'@'%';
DROP USER IF EXISTS 'rider_role'@'%';
DROP USER IF EXISTS 'support_role'@'%';
DROP USER IF EXISTS 'rideflow_app'@'%';

-- =============================================================
--database users for each platform role.
-- =============================================================

CREATE USER 'super_admin'@'%'  IDENTIFIED BY 'SuperAdminP@ssw0rd';
CREATE USER 'admin_role'@'%'   IDENTIFIED BY 'AdminP@ssw0rd123';
CREATE USER 'driver_role'@'%'  IDENTIFIED BY 'DriverP@ssw0rd123';
CREATE USER 'rider_role'@'%'   IDENTIFIED BY 'RiderP@ssw0rd123';
CREATE USER 'support_role'@'%' IDENTIFIED BY 'SupportP@ssw0rd123';
CREATE USER 'rideflow_app'@'%' IDENTIFIED BY 'AppP@ssw0rd123!';

-- =============================================================
-- SUPER_ADMIN — Full control
-- =============================================================

GRANT ALL PRIVILEGES ON defaultdb.* TO 'super_admin'@'%' WITH GRANT OPTION;

-- =============================================================
--  ADMIN_ROLE — Management and reporting
-- =============================================================

-- Read all tables
GRANT SELECT ON defaultdb.* TO 'admin_role'@'%';

-- Manage user account status
GRANT UPDATE (acc_status) ON defaultdb.users TO 'admin_role'@'%';

-- Manage driver verification
GRANT UPDATE (verify_status, avail_status) ON defaultdb.drivers TO 'admin_role'@'%';

-- Manage vehicle verification
GRANT UPDATE (verify_status) ON defaultdb.vehicles TO 'admin_role'@'%';

-- Full access to fare rules
GRANT SELECT, INSERT, UPDATE, DELETE ON defaultdb.fare_rules TO 'admin_role'@'%';

-- Full access to promo codes
GRANT SELECT, INSERT, UPDATE, DELETE ON defaultdb.promo_codes TO 'admin_role'@'%';

-- Update ride status
GRANT UPDATE (status, completed_at) ON defaultdb.rides TO 'admin_role'@'%';

-- Full access to complaints
GRANT SELECT, INSERT, UPDATE, DELETE ON defaultdb.complaints TO 'admin_role'@'%';

-- Manage driver earnings and payouts
GRANT SELECT, UPDATE ON defaultdb.driver_earnings TO 'admin_role'@'%';
GRANT SELECT, UPDATE ON defaultdb.wallet TO 'admin_role'@'%';

-- Execute stored procedures
GRANT EXECUTE ON PROCEDURE defaultdb.CalculateFare    TO 'admin_role'@'%';
GRANT EXECUTE ON PROCEDURE defaultdb.GetDriverStats   TO 'admin_role'@'%';
GRANT EXECUTE ON PROCEDURE defaultdb.AssignNextDriver TO 'admin_role'@'%';

-- =============================================================
--  DRIVER_ROLE — Driver operations only
-- =============================================================

-- Read own user profile
GRANT SELECT ON defaultdb.users TO 'driver_role'@'%';

-- Read and update own driver record
GRANT SELECT ON defaultdb.drivers TO 'driver_role'@'%';
GRANT UPDATE (avail_status, profile_photo, avg_rating, total_trips)
    ON defaultdb.drivers TO 'driver_role'@'%';

-- Register and manage own vehicles
GRANT SELECT, INSERT ON defaultdb.vehicles TO 'driver_role'@'%';
GRANT UPDATE (make, model, year, color, license_plate, vehicle_type)
    ON defaultdb.vehicles TO 'driver_role'@'%';

-- View and update rides
GRANT SELECT ON defaultdb.rides TO 'driver_role'@'%';
GRANT UPDATE (status, driver_id, vehicle_id, distance, duration, completed_at)
    ON defaultdb.rides TO 'driver_role'@'%';

-- Read locations
GRANT SELECT ON defaultdb.locations TO 'driver_role'@'%';

-- Rate riders
GRANT SELECT, INSERT ON defaultdb.ratings TO 'driver_role'@'%';

-- View own earnings
GRANT SELECT ON defaultdb.driver_earnings TO 'driver_role'@'%';

-- Manage own wallet
GRANT SELECT, UPDATE ON defaultdb.wallet TO 'driver_role'@'%';

-- Read promo codes and fare rules
GRANT SELECT ON defaultdb.promo_codes TO 'driver_role'@'%';
GRANT SELECT ON defaultdb.fare_rules  TO 'driver_role'@'%';

-- Execute procedures
GRANT EXECUTE ON PROCEDURE defaultdb.CalculateFare    TO 'driver_role'@'%';
GRANT EXECUTE ON PROCEDURE defaultdb.AssignNextDriver TO 'driver_role'@'%';

-- =============================================================
--  RIDER_ROLE — Rider operations only
-- =============================================================

-- Read own profile
GRANT SELECT ON defaultdb.users TO 'rider_role'@'%';
GRANT UPDATE (full_name, phone, password_hash) ON defaultdb.users TO 'rider_role'@'%';

-- Read available drivers and vehicles
GRANT SELECT ON defaultdb.drivers  TO 'rider_role'@'%';
GRANT SELECT ON defaultdb.vehicles TO 'rider_role'@'%';

-- Book and view rides
GRANT SELECT, INSERT ON defaultdb.rides TO 'rider_role'@'%';
GRANT UPDATE (status) ON defaultdb.rides TO 'rider_role'@'%';

-- Manage locations
GRANT SELECT, INSERT ON defaultdb.locations TO 'rider_role'@'%';

-- Make payments
GRANT SELECT, INSERT ON defaultdb.payments TO 'rider_role'@'%';
GRANT UPDATE (pay_method, pay_status, discount_appld, promo_id, transaction_date)
    ON defaultdb.payments TO 'rider_role'@'%';

-- Rate drivers
GRANT SELECT, INSERT ON defaultdb.ratings TO 'rider_role'@'%';

-- Manage own wallet
GRANT SELECT, UPDATE (balance) ON defaultdb.wallet TO 'rider_role'@'%';

-- Read promo codes and fare rules
GRANT SELECT ON defaultdb.promo_codes  TO 'rider_role'@'%';
GRANT SELECT ON defaultdb.fare_rules   TO 'rider_role'@'%';

-- File complaints
GRANT SELECT, INSERT ON defaultdb.complaints TO 'rider_role'@'%';

-- View ride history
GRANT SELECT ON defaultdb.ride_history TO 'rider_role'@'%';

-- =============================================================
-- REVOKE — Prevent unauthorized operations
-- =============================================================

-- Riders cannot access driver earnings
REVOKE SELECT ON defaultdb.driver_earnings FROM 'rider_role'@'%';

-- Drivers cannot access payments table
-- (already excluded — no grants given above)

-- Neither rider nor driver can delete rides
-- (already excluded — no DELETE grants given above)

-- =============================================================
--  RIDEFLOW_APP — Node.js application user
-- =============================================================

GRANT SELECT ON defaultdb.* TO 'rideflow_app'@'%';

GRANT INSERT ON defaultdb.users           TO 'rideflow_app'@'%';
GRANT INSERT ON defaultdb.drivers         TO 'rideflow_app'@'%';
GRANT INSERT ON defaultdb.vehicles        TO 'rideflow_app'@'%';
GRANT INSERT ON defaultdb.rides           TO 'rideflow_app'@'%';
GRANT INSERT ON defaultdb.locations       TO 'rideflow_app'@'%';
GRANT INSERT ON defaultdb.payments        TO 'rideflow_app'@'%';
GRANT INSERT ON defaultdb.ratings         TO 'rideflow_app'@'%';
GRANT INSERT ON defaultdb.complaints      TO 'rideflow_app'@'%';
GRANT INSERT ON defaultdb.wallet          TO 'rideflow_app'@'%';
GRANT INSERT ON defaultdb.driver_earnings TO 'rideflow_app'@'%';
GRANT INSERT ON defaultdb.ride_history    TO 'rideflow_app'@'%';
GRANT INSERT ON defaultdb.fare_rules      TO 'rideflow_app'@'%';
GRANT INSERT ON defaultdb.promo_codes     TO 'rideflow_app'@'%';

GRANT UPDATE ON defaultdb.users           TO 'rideflow_app'@'%';
GRANT UPDATE ON defaultdb.drivers         TO 'rideflow_app'@'%';
GRANT UPDATE ON defaultdb.vehicles        TO 'rideflow_app'@'%';
GRANT UPDATE ON defaultdb.rides           TO 'rideflow_app'@'%';
GRANT UPDATE ON defaultdb.payments        TO 'rideflow_app'@'%';
GRANT UPDATE ON defaultdb.wallet          TO 'rideflow_app'@'%';
GRANT UPDATE ON defaultdb.driver_earnings TO 'rideflow_app'@'%';
GRANT UPDATE ON defaultdb.promo_codes     TO 'rideflow_app'@'%';
GRANT UPDATE ON defaultdb.fare_rules      TO 'rideflow_app'@'%';

GRANT DELETE ON defaultdb.complaints      TO 'rideflow_app'@'%';

GRANT EXECUTE ON PROCEDURE defaultdb.CalculateFare    TO 'rideflow_app'@'%';
GRANT EXECUTE ON PROCEDURE defaultdb.GetDriverStats   TO 'rideflow_app'@'%';
GRANT EXECUTE ON PROCEDURE defaultdb.AssignNextDriver TO 'rideflow_app'@'%';

-- =============================================================
--  APPLY ALL PRIVILEGES
-- =============================================================

FLUSH PRIVILEGES;

-- =============================================================
-- VERIFICATION QUERIES
-- =============================================================

-- Check all users created:
SELECT USER, HOST FROM mysql.user
WHERE USER IN ('super_admin','admin_role','driver_role','rider_role','support_role','rideflow_app')
ORDER BY USER;

-- Check grants:
-- SHOW GRANTS FOR 'admin_role'@'%';
-- SHOW GRANTS FOR 'driver_role'@'%';
-- SHOW GRANTS FOR 'rider_role'@'%';
-- SHOW GRANTS FOR 'support_role'@'%';
-- SHOW GRANTS FOR 'rideflow_app'@'%';
-- SHOW GRANTS FOR 'super_admin'@'%';
