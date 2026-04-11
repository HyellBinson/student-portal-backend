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
      return res.json({ success:false, message:"Server error" });
    }

    if (result.length > 0) {
      res.json({
        success:true,
        student: result[0]
      });
    } else {
      res.json({
        success:false,
        message:"Invalid login details"
      });
    }

  });

});


/* GET STUDENT RESULTS – Latest & All Semesters */
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
      return res.status(500).json({ error:"DB error" });
    }

    if (allResults.length === 0) {
      return res.json({
        latest:[],
        all:[]
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
      return res.status(500).json({ error:"Failed to add notice" });
    }

    res.json({ message:"Notice uploaded successfully" });

  });

});


/* FETCH ALL NOTICES */
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
      return res.status(500).json({ error:"Failed to fetch notices" });
    }

    res.json(results);

  });

});


/* BELL COUNT */
app.get("/notices/count", (req, res) => {

  const sql = `
    SELECT COUNT(*) AS total
    FROM notices
    WHERE expires_at IS NULL OR expires_at > NOW()
  `;

  db.query(sql, (err, result) => {

    if (err) {
      console.log(err);
      return res.status(500).json({ error:"Failed to count notices" });
    }

    res.json(result[0]);

  });

});

//result upload notification multer
const multer = require("multer");

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) =>
    cb(null, Date.now() + "-" + file.originalname)
});

const upload = multer({ storage });
/* RESULT UPLOAD NOTIFICATION */
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
    // STEP 1: SAVE ALL RESULTS
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
    // STEP 2: CREATE ONLY ONE NOTICE
    // =========================

    const course_code = rows[0]?.course_code;

    if (course_code) {

      const existingNotice = await query(
        `SELECT id FROM notices
         WHERE course = ? AND semester = ? AND academic_year = ?
         LIMIT 1`,
        [course_code, semester, academic_year]
      );

      if (existingNotice.length === 0) {
        await query(
          `INSERT INTO notices (title, message, course, date_posted, expires_at)
           VALUES (?,?,?,?,?)`,
          [
            "Result Uploaded",
            `${course_code} results for ${semester} semester (${academic_year}) have been uploaded.`,
            course_code,
            new Date(),
            new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          ]
        );
      }
    }

    fs.unlinkSync(req.file.path);

    return res.json({
      message: "Results uploaded successfully (single notice created)"
    });

  } catch (err) {
    console.log(err);
    return res.status(500).json({ message: "Upload failed" });
  }
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


/* SERVER PORT
app.listen(5000, () => {
  console.log("Server running on port 5000");
});*/

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});

