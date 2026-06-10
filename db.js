require('dotenv').config();
const mysql = require('mysql2');
const fs    = require('fs');
const path  = require('path');

const sslCaPath = process.env.DB_SSL_CA
    ? path.resolve(process.env.DB_SSL_CA)
    : null;

const poolConfig = {
    host    : process.env.DB_HOST,
    port    : process.env.DB_PORT     || 26432,
    user    : process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit   : 10,
    queueLimit        : 0,
};


if (sslCaPath && fs.existsSync(sslCaPath)) {
    poolConfig.ssl = {
        ca: fs.readFileSync(sslCaPath),
        rejectUnauthorized: true
    };
} else if (process.env.DB_HOST && process.env.DB_HOST.includes('aiven')) {
    
    poolConfig.ssl = {};
}

const pool = mysql.createPool(poolConfig);

// Test connection on startup
pool.getConnection((err, connection) => {
    if (err) {
        console.error(' Database connection failed:', err.message);
    } else {
        console.log(' Database connected successfully');
        connection.release();
    }
});

module.exports = pool.promise();
