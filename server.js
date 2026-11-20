require("dotenv").config();

const path = require("path");
const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();
const isProduction = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT || 3000);

if (!process.env.DATABASE_URL) {
  console.error("Falta DATABASE_URL. Configura PostgreSQL antes de iniciar.");
  process.exit(1);
}
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error("SESSION_SECRET debe tener al menos 32 caracteres.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: (process.env.PGSSL === "true" || isProduction)
    ? { rejectUnauthorized: false }
    : false
});

app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://unpkg.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
      imgSrc: ["'self'", "data:", "https://*.tile.openstreetmap.org", "https://unpkg.com"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "data:"],
      frameSrc: ["https:", "http:"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: isProduction ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false }));

const sessionConfig = {
  store: new PgSession({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: true
  }),
  name: "webcams.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 8
  }
};
app.use(session(sessionConfig));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Espera unos minutos y vuelve a intentarlo." }
});

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username VARCHAR(80) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS webcams (
      id SERIAL PRIMARY KEY,
      name VARCHAR(140) NOT NULL,
      province VARCHAR(100) NOT NULL,
      category VARCHAR(50) NOT NULL,
      latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
      longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
      url TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS webcams_active_idx ON webcams(active);
    CREATE INDEX IF NOT EXISTS webcams_province_idx ON webcams(province);
    CREATE INDEX IF NOT EXISTS webcams_category_idx ON webcams(category);
  `);

  const username = (process.env.ADMIN_USERNAME || "").trim();
  const password = process.env.ADMIN_PASSWORD || "";
  if (username && password) {
    const existing = await pool.query("SELECT id FROM admins WHERE username = $1", [username]);
    if (existing.rowCount === 0) {
      const hash = await bcrypt.hash(password, 12);
      await pool.query(
        "INSERT INTO admins (username, password_hash) VALUES ($1, $2)",
        [username, hash]
      );
      console.log(`Administrador inicial creado: ${username}`);
    } else {
      console.log(`El administrador ${username} ya existe; no se ha cambiado su contraseña.`);
    }
  } else {
    console.warn("ADMIN_USERNAME/ADMIN_PASSWORD no configurados: no se creará administrador inicial.");
  }
}

function requireAuth(req, res, next) {
  if (!req.session.adminId) {
    return res.status(401).json({ error: "Debes iniciar sesión." });
  }
  next();
}

function requireCsrf(req, res, next) {
  const sent = req.get("x-csrf-token");
  if (!req.session.csrfToken || !sent || sent !== req.session.csrfToken) {
    return res.status(403).json({ error: "Token de seguridad no válido. Recarga la página." });
  }
  const origin = req.get("origin");
  const expected = process.env.APP_ORIGIN;
  if (origin && expected && origin !== expected) {
    return res.status(403).json({ error: "Origen no permitido." });
  }
  next();
}

function validateWebcam(body) {
  const name = String(body.name || "").trim();
  const province = String(body.province || "").trim();
  const category = String(body.category || "").trim();
  const url = String(body.url || "").trim();
  const description = String(body.description || "").trim();
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  const active = body.active !== false && body.active !== "false";

  if (!name || name.length > 140) return "El nombre es obligatorio (máximo 140 caracteres).";
  if (!province || province.length > 100) return "La provincia es obligatoria (máximo 100 caracteres).";
  if (!["Playa", "Montaña", "Ciudad", "Esquí", "Puerto", "Naturaleza", "Otros"].includes(category)) {
    return "Selecciona una categoría válida.";
  }
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return "Latitud no válida.";
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return "Longitud no válida.";
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
  } catch {
    return "La URL debe ser una dirección http:// o https:// válida.";
  }
  if (description.length > 1000) return "La descripción no puede superar 1000 caracteres.";
  return null;
}

function webcamPayload(body) {
  return {
    name: String(body.name).trim(),
    province: String(body.province).trim(),
    category: String(body.category).trim(),
    latitude: Number(body.latitude),
    longitude: Number(body.longitude),
    url: String(body.url).trim(),
    description: String(body.description || "").trim(),
    active: body.active !== false && body.active !== "false"
  };
}

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch {
    res.status(503).json({ status: "error", database: "disconnected" });
  }
});

app.get("/api/webcams", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, name, province, category, latitude, longitude, url, description
      FROM webcams
      WHERE active = TRUE
      ORDER BY name ASC
    `);
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudieron cargar las webcams." });
  }
});

app.post("/api/login", loginLimiter, async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  try {
    const result = await pool.query(
      "SELECT id, username, password_hash FROM admins WHERE username = $1",
      [username]
    );
    const admin = result.rows[0];
    const valid = admin ? await bcrypt.compare(password, admin.password_hash) : false;
    if (!valid) return res.status(401).json({ error: "Usuario o contraseña incorrectos." });

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: "No se pudo iniciar la sesión." });
      req.session.adminId = admin.id;
      req.session.username = admin.username;
      req.session.csrfToken = require("crypto").randomBytes(32).toString("hex");
      req.session.save((saveErr) => {
        if (saveErr) return res.status(500).json({ error: "No se pudo guardar la sesión." });
        res.json({ ok: true, username: admin.username, csrfToken: req.session.csrfToken });
      });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al iniciar sesión." });
  }
});

app.get("/api/session", (req, res) => {
  if (!req.session.adminId) return res.status(401).json({ authenticated: false });
  res.json({
    authenticated: true,
    username: req.session.username,
    csrfToken: req.session.csrfToken
  });
});

app.post("/api/logout", requireAuth, requireCsrf, (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: "No se pudo cerrar la sesión." });
    res.clearCookie("webcams.sid", { httpOnly: true, secure: isProduction, sameSite: "lax" });
    res.json({ ok: true });
  });
});

app.get("/api/admin/webcams", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM webcams ORDER BY created_at DESC");
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudieron cargar las cámaras." });
  }
});

app.post("/api/admin/webcams", requireAuth, requireCsrf, async (req, res) => {
  const validation = validateWebcam(req.body);
  if (validation) return res.status(400).json({ error: validation });
  const w = webcamPayload(req.body);
  try {
    const { rows } = await pool.query(`
      INSERT INTO webcams (name, province, category, latitude, longitude, url, description, active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
    `, [w.name, w.province, w.category, w.latitude, w.longitude, w.url, w.description, w.active]);
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo guardar la webcam." });
  }
});

app.put("/api/admin/webcams/:id", requireAuth, requireCsrf, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Identificador no válido." });
  const validation = validateWebcam(req.body);
  if (validation) return res.status(400).json({ error: validation });
  const w = webcamPayload(req.body);
  try {
    const { rows } = await pool.query(`
      UPDATE webcams SET
        name=$1, province=$2, category=$3, latitude=$4, longitude=$5,
        url=$6, description=$7, active=$8, updated_at=NOW()
      WHERE id=$9 RETURNING *
    `, [w.name, w.province, w.category, w.latitude, w.longitude, w.url, w.description, w.active, id]);
    if (!rows[0]) return res.status(404).json({ error: "Webcam no encontrada." });
    res.json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo actualizar la webcam." });
  }
});

app.delete("/api/admin/webcams/:id", requireAuth, requireCsrf, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Identificador no válido." });
  try {
    const result = await pool.query("DELETE FROM webcams WHERE id = $1", [id]);
    if (!result.rowCount) return res.status(404).json({ error: "Webcam no encontrada." });
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo eliminar la webcam." });
  }
});

app.use(express.static(path.join(__dirname, "public"), {
  extensions: ["html"],
  etag: true,
  maxAge: isProduction ? "1h" : 0
}));

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

initializeDatabase()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Mapa de webcams escuchando en el puerto ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("No se pudo inicializar la base de datos:", error);
    process.exit(1);
  });

process.on("SIGTERM", async () => {
  await pool.end();
  process.exit(0);
});
