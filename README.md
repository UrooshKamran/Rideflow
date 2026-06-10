# RideFlow — Database Systems Lab Project

## Setup Instructions

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Database
Edit `.env` file:

**For Local MySQL:**
```
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=rideflow
```

**For Aiven Cloud MySQL:**
```
DB_HOST=your-service.aivencloud.com
DB_PORT=your_port
DB_USER=avnadmin
DB_PASSWORD=your_aiven_password
DB_NAME=defaultdb
DB_SSL_CA=./ca.pem
```
Place your `ca.pem` file in the root project folder.

### 3. Run DDL Scripts in MySQL Workbench
Run in this order:
1. `sql/rideflow_ddl.sql` — creates all tables
2. `sql/views_procedures_triggers.sql` — creates views, procedures, triggers, events, DCL

### 4. Create Admin User
Run this in MySQL Workbench after DDL:
```sql
USE rideflow;
INSERT INTO users (full_name, email, phone, password_hash, role)
VALUES ('Admin User', 'admin@rideflow.com', '03000000000',
        '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin');
-- Default password is: password
INSERT INTO wallet (user_id) VALUES (LAST_INSERT_ID());
```

### 5. Start the Server
```bash
npm start
```

Visit: http://localhost:3000

## Default Login
| Role  | Email               | Password |
|-------|---------------------|----------|
| Admin | admin@rideflow.com  | password |

## Project Structure
```
rideflow/
├── server.js              # Main Express app
├── db.js                  # Database connection
├── .env                   # Environment variables
├── routes/
│   ├── auth.js            # Login, Register, Logout
│   ├── rider.js           # Rider dashboard, book, history, wallet
│   ├── driver.js          # Driver dashboard, trips, earnings
│   └── admin.js           # Admin panel, reports, management
├── views/
│   ├── login.ejs
│   ├── register.ejs
│   ├── partials/          # header, footer, flash
│   ├── rider/             # dashboard, book, history, wallet
│   ├── driver/            # dashboard, trips, earnings
│   └── admin/             # dashboard, users, drivers, vehicles, fare-rules, promos, reports
├── public/css/style.css   # Complete stylesheet
├── middleware/auth.js     # Role-based access guard
└── sql/
    ├── rideflow_ddl.sql                  # All tables + indexes
    └── views_procedures_triggers.sql     # Views, SP, Triggers, Events, DCL, Queries
```
