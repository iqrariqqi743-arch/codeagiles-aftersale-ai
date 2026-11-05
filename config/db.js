import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

const isNeon = Boolean(process.env.NEON_DATABASE_URL);

const pool = new Pool(
  isNeon
    ? {
        // Neon PostgreSQL
        connectionString: process.env.NEON_DATABASE_URL,
        ssl: {
          rejectUnauthorized: true,
        },
      }
    : {
        // Local PostgreSQL
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 5432),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
      },
);

pool.on("connect", () => {
  console.log(
    isNeon ? "Neon PostgreSQL connected" : "Local PostgreSQL connected",
  );
});

pool.on("error", (error) => {
  console.error("PostgreSQL pool error:", error.message);
});

export default pool;
