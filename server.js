const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");

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
  ssl: {
    rejectUnauthorized: false
  }
});

console.log("Connected to Aiven MySQL database");

/* LOGIN API */
app.post("/login", (req, res) => {
  const { reg_number, password } = req.body;

  const sql = "SELECT * FROM students WHERE reg_number=? AND password=?";

  db.query(sql, [reg_number, password], (err, result) => {
    if (err) {
      console.log(err);
      return res.json({ success: false, message: "Server error" });
    }

    if (result.length > 0) {
      res.json({
        success: true,
        student: result[0]
      });
    } else {
      res.json({
        success: false,
        message: "Invalid login details"
      });
    }
  });
});

/* GET STUDENT RESULTS */
app.get("/api/results/:reg_number", (req, res) => {
  const regNumber = req.params.reg_number;

  const sqlAll = `
    SELECT *
    FROM results
    WHERE reg_number=?
    ORDER BY
      CASE
        WHEN level='ND1' THEN 1
        WHEN level='ND2' THEN 2
        WHEN level='HND1' THEN 3
        WHEN level='HND2' THEN 4
        ELSE 5
      END,
      academic_year ASC,
      CASE
        WHEN semester='First' THEN 1
        WHEN semester='Second' THEN 2
        ELSE 3
      END
  `;

  db.query(sqlAll, [regNumber], (err, allResults) => {
    if (err) {
      console.log(err);
      return res.status(500).json({ error: "DB error" });
    }

    if (allResults.length === 0) {
      return res.json({
        latest: [],
        all: []
      });
    }

    const latestRow = allResults[allResults.length - 1];
    const latestYear = latestRow.academic_year;
    const latestSemester = latestRow.semester;
    const latestLevel = latestRow.level;

    const latestResults = allResults.filter(r =>
      r.academic_year === latestYear &&
      r.semester === latestSemester &&
      r.level === latestLevel
    );

    res.json({
      latest: latestResults,
      all: allResults
    });
  });
});

/* ADD NOTICE */
app.post("/add-notice", (req, res) => {
  const { title, message } = req.body;

  const sql = `
    INSERT INTO notices (title,message,date_posted,expires_at)
    VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 7 DAY))
  `;

  db.query(sql, [title, message], (err) => {
    if (err) {
      console.log(err);
      return res.status(500).json({ error: "Failed to add notice" });
    }

    res.json({ message: "Notice uploaded successfully" });
  });
});

/* FETCH NOTICES */
app.get("/notices", (req, res) => {
  const sql = `
    SELECT *
    FROM notices
    WHERE expires_at IS NULL OR expires_at > NOW()
    ORDER BY date_posted DESC
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.log(err);
      return res.status(500).json({ error: "Failed to fetch notices" });
    }

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
    if (err) {
      console.log(err);
      return res.status(500).json({ error: "Failed to count notices" });
    }

    res.json(result[0]);
  });
});

/* RESULT UPLOAD ROUTE (DISABLED SAFELY) */
app.post("/upload-results", (req, res) => {
  return res.status(200).json({
    message: "Result upload feature disabled to avoid duplicate notifications."
  });
});

/* STUDENT CHANGE PASSWORD */
app.post("/api/change-password", (req, res) => {
  const { reg_number, old_password, new_password } = req.body;

  if (!reg_number || !old_password || !new_password) {
    return res.json({ error: "All fields are required" });
  }

  const checkSql = "SELECT * FROM students WHERE reg_number=?";

  db.query(checkSql, [reg_number], (err, result) => {
    if (err) {
      console.log(err);
      return res.json({ error: "Server error" });
    }

    if (result.length === 0) {
      return res.json({ error: "Student not found" });
    }

    const student = result[0];

    if (student.password !== old_password) {
      return res.json({ error: "Old password is incorrect" });
    }

    const updateSql = "UPDATE students SET password=? WHERE reg_number=?";

    db.query(updateSql, [new_password, reg_number], (err2) => {
      if (err2) {
        console.log(err2);
        return res.json({ error: "Failed to update password" });
      }

      res.json({
        success: true,
        message: "Password changed successfully. Please login again."
      });
    });
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});