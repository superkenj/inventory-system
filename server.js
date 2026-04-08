const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const initSqlJs = require("sql.js");

const HOST = "127.0.0.1";
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "app.db");
const INVENTORY_REFERENCE_FILE = path.join(__dirname, "inventory-reference.json");
const INVENTORY_SEED_VERSION = "4";
const UPPERCASE_MIGRATION_VERSION = "1";
const PUBLIC_DIR = path.join(__dirname, "public");
const sessions = new Map();

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function toUpperText(value) {
  return String(value || "").trim().toUpperCase();
}

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function notFound(res) {
  json(res, 404, { error: "Not found" });
}

function unauthorized(res) {
  json(res, 401, { error: "Unauthorized" });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk.toString();
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const cookies = {};
  header.split(";").forEach((part) => {
    const [k, ...v] = part.trim().split("=");
    if (!k) return;
    cookies[k] = decodeURIComponent(v.join("="));
  });
  return cookies;
}

function getSession(req) {
  const cookies = parseCookies(req);
  const token = cookies.sessionToken;
  if (!token) return null;
  return sessions.get(token) || null;
}

function requireAdmin(req, res) {
  const session = getSession(req);
  if (!session || session.role !== "admin") {
    unauthorized(res);
    return null;
  }
  return session;
}

function loadStatic(filePath, res) {
  const resolved = path.join(PUBLIC_DIR, filePath === "/" ? "index.html" : filePath);
  if (!resolved.startsWith(PUBLIC_DIR)) {
    return notFound(res);
  }

  fs.readFile(resolved, (err, data) => {
    if (err) return notFound(res);

    const ext = path.extname(resolved).toLowerCase();
    const types = {
      ".html": "text/html",
      ".css": "text/css",
      ".js": "application/javascript",
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon"
    };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function dbRun(db, query, params = []) {
  const stmt = db.prepare(query);
  stmt.bind(params);
  stmt.step();
  stmt.free();
}

function dbAll(db, query, params = []) {
  const stmt = db.prepare(query);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function persistDb(db) {
  const bytes = db.export();
  fs.writeFileSync(DB_FILE, Buffer.from(bytes));
}

function seedParsedQuantity(row) {
  if (row.quantity === undefined || row.quantity === null || row.quantity === "") return null;
  const n = Number(row.quantity);
  return Number.isNaN(n) ? null : n;
}

function seedParsedUom(row) {
  if (row.unitOfMeasure === undefined || row.unitOfMeasure === null) return null;
  const s = String(row.unitOfMeasure).trim();
  return s === "" ? null : toUpperText(s);
}

function seedInventoryReference(db) {
  const seedRows = JSON.parse(fs.readFileSync(INVENTORY_REFERENCE_FILE, "utf8"));
  dbRun(db, "DELETE FROM inventory");
  dbRun(db, "DELETE FROM issuance_logs");
  seedRows.forEach((row) => {
    dbRun(
      db,
      "INSERT INTO inventory (item_name, unit_cost, quantity, unit_of_measure) VALUES (?, ?, ?, ?)",
      [toUpperText(row.itemName), Number(row.unitCost), seedParsedQuantity(row), seedParsedUom(row)]
    );
  });
  dbRun(
    db,
    "INSERT OR REPLACE INTO app_settings (setting_key, setting_value) VALUES (?, ?)",
    ["inventory_seed_version", INVENTORY_SEED_VERSION]
  );
  persistDb(db);
}

function runUppercaseMigration(db) {
  dbRun(db, "UPDATE inventory SET item_name = UPPER(item_name), unit_of_measure = UPPER(unit_of_measure)");
  dbRun(
    db,
    "UPDATE issuance_logs SET item_name = UPPER(item_name), unit_of_measure = UPPER(unit_of_measure), person_id = UPPER(person_id), person_name = UPPER(person_name)"
  );
  dbRun(
    db,
    "UPDATE inventory_adjustments SET item_name = UPPER(item_name), reason = UPPER(reason), adjusted_by = UPPER(adjusted_by)"
  );
  dbRun(
    db,
    "INSERT OR REPLACE INTO app_settings (setting_key, setting_value) VALUES (?, ?)",
    ["uppercase_migration_version", UPPERCASE_MIGRATION_VERSION]
  );
  persistDb(db);
}

function migrateInventoryNullableQtyUom(db) {
  const cols = dbAll(db, "PRAGMA table_info(inventory)");
  if (!cols.length) return;
  const qtyCol = cols.find((c) => c.name === "quantity");
  if (!qtyCol || qtyCol.notnull !== 1) return;

  dbRun(
    db,
    `CREATE TABLE inventory_qty_uom_mig (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_name TEXT NOT NULL,
      unit_cost REAL NOT NULL,
      quantity REAL,
      unit_of_measure TEXT
    )`
  );
  dbRun(
    db,
    `INSERT INTO inventory_qty_uom_mig (id, item_name, unit_cost, quantity, unit_of_measure)
     SELECT id, item_name, unit_cost, quantity, unit_of_measure FROM inventory`
  );
  dbRun(db, "DROP TABLE inventory");
  dbRun(db, "ALTER TABLE inventory_qty_uom_mig RENAME TO inventory");
  persistDb(db);
}

async function createApp() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const SQL = await initSqlJs({
    locateFile: (file) => path.join(__dirname, "node_modules", "sql.js", "dist", file)
  });

  let db;
  if (fs.existsSync(DB_FILE)) {
    db = new SQL.Database(fs.readFileSync(DB_FILE));
  } else {
    db = new SQL.Database();
  }

  dbRun(
    db,
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL
    )`
  );

  dbRun(
    db,
    `CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_name TEXT NOT NULL,
      unit_cost REAL NOT NULL,
      quantity REAL,
      unit_of_measure TEXT
    )`
  );

  migrateInventoryNullableQtyUom(db);

  dbRun(
    db,
    `CREATE TABLE IF NOT EXISTS issuance_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_of_measure TEXT NOT NULL,
      person_id TEXT NOT NULL,
      person_name TEXT NOT NULL,
      issued_at TEXT NOT NULL
    )`
  );

  dbRun(
    db,
    `CREATE TABLE IF NOT EXISTS inventory_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      adjustment_type TEXT NOT NULL,
      amount REAL NOT NULL,
      previous_quantity REAL NOT NULL,
      new_quantity REAL NOT NULL,
      reason TEXT NOT NULL,
      adjusted_by TEXT NOT NULL,
      adjusted_at TEXT NOT NULL
    )`
  );

  dbRun(
    db,
    `CREATE TABLE IF NOT EXISTS app_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL
    )`
  );

  const seededVersion = dbAll(
    db,
    "SELECT setting_value FROM app_settings WHERE setting_key = ?",
    ["inventory_seed_version"]
  );
  if (seededVersion.length === 0 || seededVersion[0].setting_value !== INVENTORY_SEED_VERSION) {
    seedInventoryReference(db);
  }

  const uppercaseMigration = dbAll(
    db,
    "SELECT setting_value FROM app_settings WHERE setting_key = ?",
    ["uppercase_migration_version"]
  );
  if (
    uppercaseMigration.length === 0 ||
    uppercaseMigration[0].setting_value !== UPPERCASE_MIGRATION_VERSION
  ) {
    runUppercaseMigration(db);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const route = `${req.method} ${url.pathname}`;

      if (route === "GET /api/session") {
        const session = getSession(req);
        const adminRows = dbAll(db, "SELECT id FROM users WHERE role = ?", ["admin"]);
        const needsSetup = adminRows.length === 0;
        return json(res, 200, {
          isAdmin: Boolean(session && session.role === "admin"),
          needsSetup
        });
      }

      if (route === "POST /api/setup-admin") {
        const existing = dbAll(db, "SELECT id FROM users WHERE role = ?", ["admin"]);
        if (existing.length > 0) {
          return json(res, 403, { error: "An administrator account already exists" });
        }

        let body;
        try {
          body = await readBody(req);
        } catch (err) {
          return json(res, 400, { error: err.message || "Invalid body" });
        }

        const username = String(body.username || "").trim();
        const password = String(body.password || "");
        const passwordConfirm = String(body.passwordConfirm || "");

        if (username.length < 3 || username.length > 64) {
          return json(res, 400, { error: "Username must be 3–64 characters" });
        }
        if (password.length < 8) {
          return json(res, 400, { error: "Password must be at least 8 characters" });
        }
        if (password !== passwordConfirm) {
          return json(res, 400, { error: "Passwords do not match" });
        }

        const taken = dbAll(db, "SELECT id FROM users WHERE username = ?", [username]);
        if (taken.length > 0) {
          return json(res, 400, { error: "Username is already taken" });
        }

        dbRun(db, "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)", [
          username,
          hashPassword(password),
          "admin"
        ]);
        persistDb(db);

        const row = dbAll(db, "SELECT id, username, role FROM users WHERE username = ?", [username]);
        const token = crypto.randomUUID();
        sessions.set(token, row[0]);
        res.writeHead(201, {
          "Content-Type": "application/json",
          "Set-Cookie": `sessionToken=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Strict`
        });
        return res.end(JSON.stringify({ ok: true, role: "admin" }));
      }

      if (route === "POST /api/login") {
        const body = await readBody(req);
        const username = String(body.username || "").trim();
        const password = String(body.password || "");
        const users = dbAll(
          db,
          "SELECT id, username, role FROM users WHERE username = ? AND password_hash = ?",
          [username, hashPassword(password)]
        );

        if (users.length === 0) {
          return unauthorized(res);
        }

        const token = crypto.randomUUID();
        sessions.set(token, users[0]);
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Set-Cookie": `sessionToken=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Strict`
        });
        return res.end(JSON.stringify({ ok: true, role: users[0].role }));
      }

      if (route === "POST /api/logout") {
        const cookies = parseCookies(req);
        if (cookies.sessionToken) {
          sessions.delete(cookies.sessionToken);
        }
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Set-Cookie": "sessionToken=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict"
        });
        return res.end(JSON.stringify({ ok: true }));
      }

      if (route === "GET /api/inventory") {
        const rows = dbAll(
          db,
          "SELECT id, item_name, unit_cost, quantity, unit_of_measure FROM inventory ORDER BY item_name"
        );
        return json(res, 200, rows);
      }

      if (route === "POST /api/inventory/new-item") {
        const admin = requireAdmin(req, res);
        if (!admin) return;

        const body = await readBody(req);
        const itemName = toUpperText(body.itemName);
        const unitCost = Number(body.unitCost);
        const quantity = Number(body.quantity);
        const unitOfMeasure = toUpperText(body.unitOfMeasure);

        if (!itemName || Number.isNaN(unitCost) || Number.isNaN(quantity) || !unitOfMeasure) {
          return json(res, 400, { error: "Invalid item data" });
        }

        dbRun(
          db,
          "INSERT INTO inventory (item_name, unit_cost, quantity, unit_of_measure) VALUES (?, ?, ?, ?)",
          [itemName, unitCost, quantity, unitOfMeasure]
        );
        persistDb(db);
        return json(res, 201, { ok: true });
      }

      if (route === "POST /api/inventory/update") {
        const admin = requireAdmin(req, res);
        if (!admin) return;

        const body = await readBody(req);
        const itemId = Number(body.itemId);
        const itemName = toUpperText(body.itemName);
        const unitCost = Number(body.unitCost);

        if (Number.isNaN(itemId) || !itemName || Number.isNaN(unitCost) || unitCost < 0) {
          return json(res, 400, { error: "Invalid item update data" });
        }

        const rows = dbAll(db, "SELECT id FROM inventory WHERE id = ?", [itemId]);
        if (rows.length === 0) {
          return json(res, 404, { error: "Item not found" });
        }

        dbRun(db, "UPDATE inventory SET item_name = ?, unit_cost = ? WHERE id = ?", [
          itemName,
          unitCost,
          itemId
        ]);
        persistDb(db);
        return json(res, 200, { ok: true });
      }

      if (route === "POST /api/inventory/add-stock") {
        const admin = requireAdmin(req, res);
        if (!admin) return;

        const body = await readBody(req);
        const itemId = Number(body.itemId);
        const amount = Number(body.amount);

        if (Number.isNaN(itemId) || Number.isNaN(amount) || amount <= 0) {
          return json(res, 400, { error: "Invalid stock amount" });
        }

        const rows = dbAll(db, "SELECT id FROM inventory WHERE id = ?", [itemId]);
        if (rows.length === 0) {
          return json(res, 404, { error: "Item not found" });
        }

        dbRun(db, "UPDATE inventory SET quantity = COALESCE(quantity, 0) + ? WHERE id = ?", [
          amount,
          itemId
        ]);
        persistDb(db);
        return json(res, 200, { ok: true });
      }

      if (route === "POST /api/inventory/adjust") {
        const admin = requireAdmin(req, res);
        if (!admin) return;

        const body = await readBody(req);
        const itemId = Number(body.itemId);
        const amount = Number(body.amount);
        const reason = toUpperText("STOCK DEDUCTION");

        if (Number.isNaN(itemId) || Number.isNaN(amount) || amount <= 0) {
          return json(res, 400, { error: "Invalid deduction request" });
        }

        const itemRows = dbAll(
          db,
          "SELECT id, item_name, quantity FROM inventory WHERE id = ?",
          [itemId]
        );
        if (itemRows.length === 0) {
          return json(res, 404, { error: "Item not found" });
        }

        const item = itemRows[0];
        const previousQuantity =
          item.quantity == null || item.quantity === "" || Number.isNaN(Number(item.quantity))
            ? 0
            : Number(item.quantity);
        const newQuantity = previousQuantity - amount;

        if (newQuantity < 0) {
          return json(res, 400, {
            error: "Deduction exceeds available stock. Quantity cannot go below zero."
          });
        }

        dbRun(db, "UPDATE inventory SET quantity = ? WHERE id = ?", [newQuantity, itemId]);
        dbRun(
          db,
          `INSERT INTO inventory_adjustments (
            item_id, item_name, adjustment_type, amount, previous_quantity, new_quantity,
            reason, adjusted_by, adjusted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            itemId,
            item.item_name,
            "deduct",
            amount,
            previousQuantity,
            newQuantity,
            reason,
            toUpperText(admin.username),
            new Date().toISOString()
          ]
        );
        persistDb(db);
        return json(res, 200, { ok: true });
      }

      if (route === "POST /api/inventory/delete-item") {
        const admin = requireAdmin(req, res);
        if (!admin) return;

        const body = await readBody(req);
        const itemId = Number(body.itemId);

        if (Number.isNaN(itemId)) {
          return json(res, 400, { error: "Invalid item" });
        }

        const rows = dbAll(db, "SELECT id FROM inventory WHERE id = ?", [itemId]);
        if (rows.length === 0) {
          return json(res, 404, { error: "Item not found" });
        }

        dbRun(db, "DELETE FROM inventory WHERE id = ?", [itemId]);
        persistDb(db);
        return json(res, 200, { ok: true });
      }

      if (route === "POST /api/checkout") {
        const body = await readBody(req);
        const itemId = Number(body.itemId);
        const quantity = Number(body.quantity);
        const personId = toUpperText(body.personId);
        const personName = toUpperText(body.personName);

        if (Number.isNaN(itemId) || Number.isNaN(quantity) || quantity <= 0 || !personId || !personName) {
          return json(res, 400, { error: "Missing checkout fields" });
        }

        const items = dbAll(
          db,
          "SELECT id, item_name, quantity, unit_of_measure FROM inventory WHERE id = ?",
          [itemId]
        );
        if (items.length === 0) {
          return json(res, 404, { error: "Item not found" });
        }
        const item = items[0];
        const available =
          item.quantity == null || item.quantity === ""
            ? 0
            : Number(item.quantity);
        if (Number.isNaN(available) || available < quantity) {
          return json(res, 400, { error: "Insufficient quantity" });
        }

        dbRun(db, "UPDATE inventory SET quantity = COALESCE(quantity, 0) - ? WHERE id = ?", [
          quantity,
          itemId
        ]);
        const uomForLog =
          item.unit_of_measure != null && String(item.unit_of_measure).trim() !== ""
            ? item.unit_of_measure
            : "";
        dbRun(
          db,
          `INSERT INTO issuance_logs (
            item_id, item_name, quantity, unit_of_measure, person_id, person_name, issued_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [itemId, item.item_name, quantity, uomForLog, personId, personName, new Date().toISOString()]
        );
        persistDb(db);
        return json(res, 200, { ok: true });
      }

      if (route === "GET /api/logs") {
        const rows = dbAll(
          db,
          "SELECT item_name, quantity, unit_of_measure, person_id, person_name, issued_at FROM issuance_logs ORDER BY issued_at DESC"
        );
        return json(res, 200, rows);
      }

      if (req.method === "GET") {
        if (url.pathname === "/favicon.ico") {
          return loadStatic("assets/ccro-logo.png", res);
        }
        const filePath = url.pathname === "/" ? "/" : decodeURIComponent(url.pathname);
        return loadStatic(filePath, res);
      }

      return notFound(res);
    } catch (err) {
      json(res, 500, { error: err.message || "Server error" });
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`);
  });
}

createApp().catch((err) => {
  console.error("Failed to start app:", err);
  process.exit(1);
});
