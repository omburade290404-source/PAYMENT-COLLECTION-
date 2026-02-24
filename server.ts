import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("payments.db");

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id TEXT UNIQUE,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    address TEXT NOT NULL,
    amount REAL NOT NULL,
    status TEXT DEFAULT 'success',
    is_trashed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  INSERT OR IGNORE INTO settings (key, value) VALUES ('payment_status', 'active');
`);

// Migration: Add is_trashed column if it doesn't exist
try {
  db.prepare("ALTER TABLE payments ADD COLUMN is_trashed INTEGER DEFAULT 0").run();
} catch (e) {
  // Column already exists or other error
}

async function startServer() {
  const app = express();
  app.use(express.json());

  // API Routes

  // Manual QR Payment Initiation
  app.post("/api/initiate-manual-payment", (req, res) => {
    try {
      const status = db.prepare("SELECT value FROM settings WHERE key = 'payment_status'").get() as { value: string };
      if (status.value === 'paused') {
        return res.status(403).json({ error: "Payments are currently paused by the administrator." });
      }

      const { name, phone, address, amount } = req.body;
      const upiId = process.env.ADMIN_UPI_ID || "9511648488@ybl"; // Default if not set
      const adminName = process.env.ADMIN_NAME || "Abhay Rathod";
      
      // UPI URL format: upi://pay?pa=address@bank&pn=PayeeName&am=100.00&cu=INR
      const upiUrl = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(adminName)}&am=${amount}&cu=INR&tn=${encodeURIComponent("Payment from " + name)}`;

      res.json({ upiUrl });
    } catch (error) {
      res.status(500).json({ error: "Failed to initiate payment" });
    }
  });

  // Submit Manual Payment
  app.post("/api/submit-manual-payment", (req, res) => {
    try {
      const status = db.prepare("SELECT value FROM settings WHERE key = 'payment_status'").get() as { value: string };
      if (status.value === 'paused') {
        return res.status(403).json({ error: "Payments are currently paused by the administrator." });
      }

      const { name, phone, address, amount } = req.body;
      
      // Generate Unique Receipt ID: REC-[YYYYMMDD]-[Sequential Number]
      const today = new Date();
      const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
      
      // Get count of payments today to generate sequential number
      const countStmt = db.prepare("SELECT COUNT(*) as count FROM payments WHERE created_at >= date('now')");
      const { count } = countStmt.get() as { count: number };
      const sequentialNumber = (count + 1).toString().padStart(4, '0');
      
      const transactionId = `REC-${dateStr}-${sequentialNumber}`;
      
      const stmt = db.prepare(`
        INSERT INTO payments (transaction_id, name, phone, address, amount, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(transactionId, name, phone, address, amount, 'success');

      const payment = db.prepare("SELECT * FROM payments WHERE transaction_id = ?").get(transactionId);
      res.json({ status: "success", transactionId, payment });
    } catch (error) {
      console.error("Error saving payment:", error);
      res.status(500).json({ error: "Failed to save payment" });
    }
  });

  // Admin Login
  app.post("/api/admin/login", (req, res) => {
    const { username, password } = req.body;
    const adminUser = process.env.ADMIN_USERNAME || "Abhay";
    const adminPass = process.env.ADMIN_PASSWORD || "Abhay123";

    if (username === adminUser && password === adminPass) {
      res.json({ success: true, token: "admin-session-token" });
    } else {
      res.status(401).json({ success: false, error: "Invalid credentials" });
    }
  });

  // Get Payments (Admin)
  app.get("/api/admin/payments", (req, res) => {
    const payments = db.prepare("SELECT * FROM payments WHERE is_trashed = 0 ORDER BY created_at DESC").all();
    res.json(payments);
  });

  // Get Trashed Payments (Admin)
  app.get("/api/admin/trash", (req, res) => {
    const payments = db.prepare("SELECT * FROM payments WHERE is_trashed = 1 ORDER BY created_at DESC").all();
    res.json(payments);
  });

  // Get Payment Status (Admin/Public)
  app.get("/api/payment-status", (req, res) => {
    const status = db.prepare("SELECT value FROM settings WHERE key = 'payment_status'").get() as { value: string };
    res.json(status);
  });

  // Update Payment Status (Admin)
  app.post("/api/admin/update-status", (req, res) => {
    const { status } = req.body;
    if (status !== 'active' && status !== 'paused') {
      return res.status(400).json({ error: "Invalid status" });
    }
    db.prepare("UPDATE settings SET value = ? WHERE key = 'payment_status'").run(status);
    res.json({ success: true, status });
  });

  // Move Single Payment to Trash (Admin)
  app.post("/api/admin/delete-payment/:id", (req, res) => {
    try {
      const { id } = req.params;
      db.prepare("UPDATE payments SET is_trashed = 1 WHERE id = ?").run(id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to move payment to trash" });
    }
  });

  // Restore Single Payment from Trash (Admin)
  app.post("/api/admin/restore-payment/:id", (req, res) => {
    try {
      const { id } = req.params;
      db.prepare("UPDATE payments SET is_trashed = 0 WHERE id = ?").run(id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to restore payment" });
    }
  });

  // Permanently Delete Single Payment (Admin)
  app.post("/api/admin/permanent-delete/:id", (req, res) => {
    try {
      const { id } = req.params;
      db.prepare("DELETE FROM payments WHERE id = ? AND is_trashed = 1").run(id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to permanently delete payment" });
    }
  });

  // Move All Payments to Trash (Admin)
  app.post("/api/admin/clear-payments", (req, res) => {
    try {
      db.prepare("UPDATE payments SET is_trashed = 1 WHERE is_trashed = 0").run();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to move payments to trash" });
    }
  });

  // Restore All Payments from Trash (Admin)
  app.post("/api/admin/restore-payments", (req, res) => {
    try {
      db.prepare("UPDATE payments SET is_trashed = 0 WHERE is_trashed = 1").run();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to restore payments" });
    }
  });

  // Permanently Delete All Trashed Payments (Admin)
  app.post("/api/admin/empty-trash", (req, res) => {
    try {
      db.prepare("DELETE FROM payments WHERE is_trashed = 1").run();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to empty trash" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  const PORT = 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
