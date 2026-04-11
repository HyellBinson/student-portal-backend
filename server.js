const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const app = express();

app.use(cors());
app.use(express.json());

/* DATABASE CONNECTION (AIVEN CLOUD) */
const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false }
});

console.log("Connected to Aiven MySQL database");

/* LOGIN API */
app.post("/login", (req, res) => {
  const { reg_number, password } = req.body;

  const sql = "SELECT * FROM students WHERE reg_number=? AND password=?";

  db.query(sql, [reg_number, password], (err, result) => {
    if (err) return res.json({ success: false, message: "Server error" });

    if (result.length > 0) {
      res.json({ success: true, student: result[0] });
    } else {
      res.json({ success: false, message: "Invalid login details" });
    }
  });
});

/* GET RESULTS */
app.get("/api/results/:reg_number", (req, res) => {
  const regNumber = req.params.reg_number;

  const sql = `
    SELECT *
    FROM results
    WHERE reg_number=?
    ORDER BY academic_year ASC
  `;

  db.query(sql, [regNumber], (err, results) => {
    if (err) return res.status(500).json({ error: "DB error" });

    res.json({
      latest: results,
      all: results
    });
  });
});

/* ADD NOTICE (MANUAL SYSTEM - KEEP SAFE) */
app.post("/add-notice", (req, res) => {
  const { title, message } = req.body;

  const sql = `
    INSERT INTO notices (title,message,date_posted,expires_at)
    VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 7 DAY))
  `;

  db.query(sql, [title, message], (err) => {
    if (err) return res.status(500).json({ error: "Failed to add notice" });

    res.json({ message: "Notice uploaded successfully" });
  });
});

/* GET NOTICES */
app.get("/notices", (req, res) => {
  const sql = `
    SELECT *
    FROM notices
    WHERE expires_at IS NULL OR expires_at > NOW()
    ORDER BY date_posted DESC
  `;

  db.query(sql, (err, results) => {
    if (err) return res.status(500).json({ error: "Failed to fetch notices" });

    res.json(results);
  });
});

/* NOTICES COUNT */
app.get("/notices/count", (req, res) => {
  const sql = `
    SELECT COUNT(*) AS total
    FROM notices
    WHERE expires_at IS NULL OR expires_at > NOW()
  `;

  db.query(sql, (err, result) => {
    if (err) return res.status(500).json({ error: "Failed to count notices" });

    res.json(result[0]);
  });
});

/* FILE UPLOAD CONFIG */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) =>
    cb(null, Date.now() + "-" + file.originalname)
});

const upload = multer({ storage });

/* RESULT UPLOAD (FIXED - NO DUPLICATE NOTICES) */
app.post("/upload-results", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.json({ message: "No file uploaded" });
    }

    const { level, semester, academic_year } = req.body;

    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    const query = (sql, params) =>
      new Promise((resolve, reject) => {
        db.query(sql, params, (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });

    // =========================
    // SAVE RESULTS ONLY
    // =========================
    for (const row of rows) {
      const {
        reg_number,
        full_name,
        course_code,
        course_title,
        unit,
        score
      } = row;

      if (!reg_number || !course_code) continue;

      const existing = await query(
        `SELECT * FROM results
         WHERE reg_number=? AND course_code=? AND semester=? AND academic_year=?`,
        [reg_number, course_code, semester, academic_year]
      );

      if (existing.length === 0) {
        await query(
          `INSERT INTO results
          (reg_number, course_code, course_title, unit, score, semester, academic_year, level)
          VALUES (?,?,?,?,?,?,?,?)`,
          [
            reg_number,
            course_code,
            course_title,
            unit,
            score,
            semester,
            academic_year,
            level
          ]
        );
      }
    }

    // =========================
    // ONE NOTICE ONLY (SAFE FIX)
    // =========================

    const existingNotice = await query(
      `SELECT id FROM notices
       WHERE title = ? AND message LIKE ? LIMIT 1`,
      [
        "Result Uploaded",
        `%${semester}%${academic_year}%`
      ]
    );

    if (existingNotice.length === 0) {
      await query(
        `INSERT INTO notices (title, message, date_posted, expires_at)
         VALUES (?,?,NOW(),?)`,
        [
          "Result Uploaded",
          `Results for ${semester} semester (${academic_year}) have been uploaded.`,
          new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        ]
      );
    }

    fs.unlinkSync(req.file.path);

    return res.json({
      message: "Upload successful (1 notice only)"
    });

  } catch (err) {
    console.log(err);
    return res.status(500).json({ message: "Upload failed" });
  }
});

/* SERVER */
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});