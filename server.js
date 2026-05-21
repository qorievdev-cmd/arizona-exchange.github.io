const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = 3000;
const JWT_SECRET = "arizona-secret-key-2026";

// ========== НАСТРОЙКА ПОЧТЫ ==========
let transporter = null;
try {
  transporter = nodemailer.createTransport({
    host: "smtp.ethereal.email",
    port: 587,
    secure: false,
    auth: { user: "test@ethereal.email", pass: "test123" },
  });
  console.log("✅ Email настроен");
} catch (e) {
  console.log("⚠️ Email не настроен");
}

// ========== MIDDLEWARE ==========
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.static("public"));

// ========== НАСТРОЙКА ЗАГРУЗКИ ФАЙЛОВ ==========
const uploadsDir = path.join(__dirname, "uploads");
const avatarsDir = path.join(__dirname, "public", "avatars");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === "avatar") {
      cb(null, avatarsDir);
    } else {
      const folderId = req.body.folderId || "general";
      const uploadPath = path.join(uploadsDir, String(folderId));
      if (!fs.existsSync(uploadPath))
        fs.mkdirSync(uploadPath, { recursive: true });
      cb(null, uploadPath);
    }
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${uuidv4().slice(0, 8)}-${
      file.originalname
    }`;
    cb(null, uniqueName);
  },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ========== БАЗА ДАННЫХ ==========
const sqlite3 = require("sqlite3").verbose();
const dbPath = path.join(__dirname, "arizona.db");
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        email TEXT UNIQUE,
        password_hash TEXT,
        full_name TEXT,
        role TEXT,
        avatar TEXT,
        avatar_file TEXT,
        is_active INTEGER DEFAULT 1,
        must_change_password INTEGER DEFAULT 1,
        temp_password TEXT,
        last_seen TEXT,
        created_at TEXT
    )`);

  db.run(`CREATE TABLE IF NOT EXISTS folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        description TEXT,
        allowed_roles TEXT,
        icon TEXT,
        is_favorite INTEGER DEFAULT 0,
        created_by INTEGER
    )`);

  db.run(`CREATE TABLE IF NOT EXISTS folder_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        folder_id INTEGER,
        user_id INTEGER,
        UNIQUE(folder_id, user_id)
    )`);

  db.run(`CREATE TABLE IF NOT EXISTS group_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        folder_id INTEGER,
        user_id INTEGER,
        message TEXT,
        reply_to INTEGER,
        file_type TEXT,
        file_url TEXT,
        is_audio INTEGER DEFAULT 0,
        audio_duration INTEGER,
        created_at TEXT,
        edited_at TEXT,
        is_edited INTEGER DEFAULT 0,
        is_pinned INTEGER DEFAULT 0
    )`);

  db.run(`CREATE TABLE IF NOT EXISTS message_reactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER,
        user_id INTEGER,
        reaction TEXT,
        UNIQUE(message_id, user_id, reaction)
    )`);

  db.run(`CREATE TABLE IF NOT EXISTS time_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        clock_in TEXT,
        clock_out TEXT,
        date TEXT,
        status TEXT,
        approved INTEGER DEFAULT 0,
        is_late INTEGER DEFAULT 0,
        late_minutes INTEGER DEFAULT 0,
        overtime_hours REAL DEFAULT 0,
        overtime_approved INTEGER DEFAULT 0,
        overtime_request TEXT,
        forced_stop INTEGER DEFAULT 0
    )`);

  db.run(`CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        type TEXT,
        data TEXT,
        created_at TEXT,
        is_read INTEGER DEFAULT 0
    )`);

  db.run(`CREATE TABLE IF NOT EXISTS user_read_status (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        message_id INTEGER,
        UNIQUE(user_id, message_id)
    )`);
});

async function setupUsers() {
  const adminHash = await bcrypt.hash("admin123", 10);
  const managerHash = await bcrypt.hash("manager123", 10);
  const empHash = await bcrypt.hash("emp123", 10);
  const accountantHash = await bcrypt.hash("acc123", 10);

  db.run(
    `INSERT OR IGNORE INTO users (username, email, password_hash, full_name, role, avatar, must_change_password, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      "admin",
      "admin@arizona.ru",
      adminHash,
      "Администратор",
      "admin",
      "👑",
      0,
      new Date().toISOString(),
    ]
  );
  db.run(
    `INSERT OR IGNORE INTO users (username, email, password_hash, full_name, role, avatar, must_change_password, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      "manager1",
      "manager@arizona.ru",
      managerHash,
      "Управляющий Алексей",
      "manager",
      "👔",
      0,
      new Date().toISOString(),
    ]
  );
  db.run(
    `INSERT OR IGNORE INTO users (username, email, password_hash, full_name, role, avatar, must_change_password, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      "accountant1",
      "accountant@arizona.ru",
      accountantHash,
      "Бухгалтер Галина",
      "accountant",
      "💰",
      0,
      new Date().toISOString(),
    ]
  );
  db.run(
    `INSERT OR IGNORE INTO users (username, email, password_hash, full_name, role, avatar, must_change_password, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      "employee1",
      "employee1@arizona.ru",
      empHash,
      "Повар Дмитрий",
      "employee",
      "🍳",
      0,
      new Date().toISOString(),
    ]
  );
  db.run(
    `INSERT OR IGNORE INTO users (username, email, password_hash, full_name, role, avatar, must_change_password, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      "employee2",
      "employee2@arizona.ru",
      empHash,
      "Бармен Анна",
      "employee",
      "🍸",
      0,
      new Date().toISOString(),
    ]
  );

  const chats = [
    [
      1,
      "💬 Общий чат",
      "Все сотрудники",
      "employee,manager,accountant,admin",
      "💬",
    ],
    [
      2,
      "💰 Бухгалтерия",
      "Финансовые вопросы",
      "accountant,manager,admin",
      "💰",
    ],
    [3, "👑 Управление", "Только руководство", "manager,admin", "👑"],
    [4, "🍔 Кухня", "Повара и шефы", "employee,manager,admin", "🍔"],
    [
      5,
      "📊 График",
      "Расписание сотрудников",
      "employee,manager,accountant,admin",
      "📅",
    ],
    [6, "📋 Менеджмент", "Управленческие вопросы", "manager,admin", "📋"],
    [
      7,
      "🚚 Перемещение",
      "Товары и ингредиенты",
      "employee,manager,admin",
      "🚚",
    ],
    [8, "📄 Накладные", "Документы и счета", "manager,accountant,admin", "📄"],
    [
      9,
      "🎓 Обучение",
      "Видеоуроки и инструкции",
      "employee,manager,accountant,admin",
      "🎓",
    ],
    [10, "🧹 Уборка", "График уборки", "employee,manager,admin", "🧹"],
    [11, "📝 Списание", "Списание продуктов", "manager,admin", "📝"],
    [
      12,
      "📦 Контур Маркет",
      "Заказы поставщикам",
      "manager,accountant,admin",
      "📦",
    ],
    [13, "🛵 Заказы Маркус", "Доставка", "employee,manager,admin", "🛵"],
    [
      14,
      "⛔ Стоп-листы",
      "Отсутствующие позиции",
      "employee,manager,admin",
      "⛔",
    ],
    [15, "📐 Спецификации", "Рецепты и ТТК", "employee,manager,admin", "📐"],
  ];

  for (const chat of chats) {
    db.run(
      `INSERT OR IGNORE INTO folders (id, name, description, allowed_roles, icon) VALUES (?, ?, ?, ?, ?)`,
      chat
    );
  }

  console.log("✅ База данных готова");
  console.log("📋 Учетные записи:");
  console.log("   admin / admin123 (админ)");
  console.log("   manager1 / manager123 (менеджер)");
  console.log("   accountant1 / acc123 (бухгалтер)");
  console.log("   employee1 / emp123 (сотрудник)");
}

setupUsers();

// ========== MIDDLEWARE АУТЕНТИФИКАЦИИ ==========
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Не авторизован" });
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    req.userRole = decoded.role;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Недействительный токен" });
  }
}

// ========== API МАРШРУТЫ ==========

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  db.get(
    `SELECT * FROM users WHERE (username = ? OR email = ?) AND is_active = 1`,
    [username, username],
    async (err, user) => {
      if (err || !user)
        return res.status(401).json({ error: "Неверный логин или пароль" });

      let isValid = await bcrypt.compare(password, user.password_hash);
      if (!isValid && user.temp_password === password) isValid = true;
      if (!isValid)
        return res.status(401).json({ error: "Неверный логин или пароль" });

      db.run(
        `UPDATE users SET last_seen = ?, temp_password = NULL WHERE id = ?`,
        [new Date().toISOString(), user.id]
      );

      const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, {
        expiresIn: "8h",
      });
      res.json({
        success: true,
        token,
        mustChangePassword: user.must_change_password === 1,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          fullName: user.full_name,
          role: user.role,
          avatar: user.avatar_file
            ? `/avatars/${user.avatar_file}`
            : user.avatar || "👤",
        },
      });
    }
  );
});

app.get("/api/me", authMiddleware, (req, res) => {
  db.get(
    `SELECT id, username, email, full_name, role, avatar, avatar_file FROM users WHERE id = ?`,
    [req.userId],
    (err, user) => {
      res.json({ user: user });
    }
  );
});

app.post(
  "/api/upload-avatar",
  authMiddleware,
  upload.single("avatar"),
  (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Файл не загружен" });
    db.run(
      `UPDATE users SET avatar_file = ?, avatar = NULL WHERE id = ?`,
      [req.file.filename, req.userId],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, avatarUrl: `/avatars/${req.file.filename}` });
      }
    );
  }
);

app.put("/api/change-password", authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  db.get(
    `SELECT password_hash FROM users WHERE id = ?`,
    [req.userId],
    async (err, user) => {
      if (err || !user)
        return res.status(404).json({ error: "Пользователь не найден" });
      const valid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!valid)
        return res.status(401).json({ error: "Неверный текущий пароль" });
      const newHash = await bcrypt.hash(newPassword, 10);
      db.run(
        `UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?`,
        [newHash, req.userId],
        () => {
          res.json({ success: true });
        }
      );
    }
  );
});

app.post("/api/users", authMiddleware, async (req, res) => {
  if (req.userRole !== "admin" && req.userRole !== "manager") {
    return res.status(403).json({ error: "Доступ запрещен" });
  }
  const { email, fullName, role } = req.body;
  if (!email || !fullName)
    return res.status(400).json({ error: "Email и ФИО обязательны" });

  const tempPassword = Math.random().toString(36).slice(-8);
  const passwordHash = await bcrypt.hash(tempPassword, 10);
  const username = email.split("@")[0] + Math.floor(Math.random() * 1000);

  db.run(
    `INSERT INTO users (username, email, password_hash, full_name, role, temp_password, must_change_password, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    [
      username,
      email,
      passwordHash,
      fullName,
      role,
      tempPassword,
      new Date().toISOString(),
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (transporter) {
        transporter
          .sendMail({
            from: "Хищник Бургерс <noreply@steakhouse.ru>",
            to: email,
            subject: "Добро пожаловать!",
            html: `<h2>🥩 Добро пожаловать!</h2><p>Ваш пароль: <strong>${tempPassword}</strong></p><p>После входа смените пароль.</p>`,
          })
          .catch((e) => console.log("Email не отправлен"));
      }
      res.json({ success: true, userId: this.lastID, tempPassword });
    }
  );
});

app.get("/api/users", authMiddleware, (req, res) => {
  if (req.userRole !== "admin" && req.userRole !== "manager") {
    return res.status(403).json({ error: "Доступ запрещен" });
  }
  db.all(
    `SELECT id, username, email, full_name, role, avatar, avatar_file, created_at FROM users WHERE is_active = 1`,
    (err, users) => {
      res.json({ users: users || [] });
    }
  );
});

app.delete("/api/users/:userId", authMiddleware, (req, res) => {
  if (req.userRole !== "admin")
    return res.status(403).json({ error: "Доступ запрещен" });
  db.run(
    `UPDATE users SET is_active = 0 WHERE id = ?`,
    [req.params.userId],
    () => {
      res.json({ success: true });
    }
  );
});

app.get("/api/folders", authMiddleware, (req, res) => {
  db.all(
    `SELECT f.* FROM folders f WHERE f.allowed_roles LIKE '%' || ? || '%' ORDER BY f.is_favorite DESC, f.id`,
    [req.userRole],
    (err, folders) => {
      if (err) return res.json({ folders: [] });
      db.all(
        `SELECT gm.folder_id, COUNT(*) as count FROM group_messages gm 
                LEFT JOIN user_read_status urs ON gm.id = urs.message_id AND urs.user_id = ? 
                WHERE urs.id IS NULL AND gm.user_id != ? GROUP BY gm.folder_id`,
        [req.userId, req.userId],
        (err, unread) => {
          const unreadMap = {};
          (unread || []).forEach((u) => {
            unreadMap[u.folder_id] = u.count;
          });
          folders.forEach((f) => {
            f.unread = unreadMap[f.id] || 0;
          });
          res.json({ folders: folders || [] });
        }
      );
    }
  );
});

app.post("/api/folders", authMiddleware, (req, res) => {
  if (req.userRole !== "admin" && req.userRole !== "manager") {
    return res.status(403).json({ error: "Доступ запрещен" });
  }
  const { name, description, allowed_roles, icon } = req.body;
  db.run(
    `INSERT INTO folders (name, description, allowed_roles, icon, created_by) VALUES (?, ?, ?, ?, ?)`,
    [
      name,
      description || "",
      allowed_roles || "employee,manager,accountant,admin",
      icon || "💬",
      req.userId,
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, id: this.lastID });
    }
  );
});

app.post("/api/folders/:folderId/members", authMiddleware, (req, res) => {
  if (req.userRole !== "admin" && req.userRole !== "manager") {
    return res.status(403).json({ error: "Доступ запрещен" });
  }
  db.run(
    `INSERT OR IGNORE INTO folder_members (folder_id, user_id) VALUES (?, ?)`,
    [req.params.folderId, req.body.userId],
    (err) => {
      res.json({ success: true });
    }
  );
});

app.put("/api/folders/favorite/:folderId", authMiddleware, (req, res) => {
  db.run(
    `UPDATE folders SET is_favorite = ? WHERE id = ?`,
    [req.body.isFavorite ? 1 : 0, req.params.folderId],
    () => {
      res.json({ success: true });
    }
  );
});

app.get("/api/group-messages/:folderId", authMiddleware, (req, res) => {
  db.all(
    `SELECT gm.*, u.full_name, u.role, 
            COALESCE(u.avatar_file, u.avatar) as user_avatar,
            (SELECT json_group_array(json_object('user_id', mr.user_id, 'reaction', mr.reaction)) FROM message_reactions mr WHERE mr.message_id = gm.id) as reactions
            FROM group_messages gm 
            JOIN users u ON gm.user_id = u.id 
            WHERE gm.folder_id = ? 
            ORDER BY gm.created_at ASC`,
    [req.params.folderId],
    (err, messages) => {
      if (messages) {
        messages.forEach((msg) => {
          if (msg.reactions) {
            try {
              msg.reactions = JSON.parse(msg.reactions);
            } catch (e) {
              msg.reactions = [];
            }
          } else {
            msg.reactions = [];
          }
        });
        res.json({ messages: messages || [] });
      } else {
        res.json({ messages: [] });
      }
    }
  );
});

app.post(
  "/api/group-messages",
  authMiddleware,
  upload.single("file"),
  (req, res) => {
    const { folderId, message, replyTo, isAudio, audioDuration } = req.body;
    let fileUrl = null,
      fileType = null;
    if (req.file) {
      fileUrl = `/uploads/${req.body.folderId}/${req.file.filename}`;
      fileType = req.file.mimetype.startsWith("image/") ? "image" : "file";
    }
    db.run(
      `INSERT INTO group_messages (folder_id, user_id, message, reply_to, file_type, file_url, is_audio, audio_duration, created_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        folderId,
        req.userId,
        message || null,
        replyTo || null,
        fileType,
        fileUrl,
        isAudio || 0,
        audioDuration || null,
        new Date().toISOString(),
      ],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, id: this.lastID });
      }
    );
  }
);

app.post("/api/mark-read/:folderId", authMiddleware, (req, res) => {
  db.run(
    `INSERT OR IGNORE INTO user_read_status (user_id, message_id)
            SELECT ?, id FROM group_messages WHERE folder_id = ? AND user_id != ?`,
    [req.userId, req.params.folderId, req.userId],
    () => res.json({ success: true })
  );
});

app.post("/api/message-reaction", authMiddleware, (req, res) => {
  db.run(
    `INSERT OR REPLACE INTO message_reactions (message_id, user_id, reaction) VALUES (?, ?, ?)`,
    [req.body.messageId, req.userId, req.body.reaction],
    () => res.json({ success: true })
  );
});

app.put("/api/group-messages/:messageId", authMiddleware, (req, res) => {
  const { messageId } = req.params;
  db.get(
    `SELECT user_id, created_at FROM group_messages WHERE id = ?`,
    [messageId],
    (err, msg) => {
      if (!msg) return res.status(404).json({ error: "Сообщение не найдено" });
      const minutesPassed = (new Date() - new Date(msg.created_at)) / 60000;
      const canEdit =
        (msg.user_id === req.userId && minutesPassed <= 30) ||
        req.userRole === "admin";
      if (!canEdit)
        return res.status(403).json({ error: "Редактирование недоступно" });
      db.run(
        `UPDATE group_messages SET message = ?, edited_at = ?, is_edited = 1 WHERE id = ?`,
        [req.body.message, new Date().toISOString(), messageId],
        () => res.json({ success: true })
      );
    }
  );
});

app.delete("/api/group-messages/:messageId", authMiddleware, (req, res) => {
  db.get(
    `SELECT user_id, created_at FROM group_messages WHERE id = ?`,
    [req.params.messageId],
    (err, msg) => {
      if (!msg) return res.status(404).json({ error: "Сообщение не найдено" });
      const minutesPassed = (new Date() - new Date(msg.created_at)) / 60000;
      const canDelete =
        (msg.user_id === req.userId && minutesPassed <= 30) ||
        req.userRole === "admin";
      if (!canDelete)
        return res.status(403).json({ error: "Удаление недоступно" });
      db.run(
        `DELETE FROM group_messages WHERE id = ?`,
        [req.params.messageId],
        () => res.json({ success: true })
      );
    }
  );
});

app.get("/api/search", authMiddleware, (req, res) => {
  db.all(
    `SELECT gm.*, u.full_name, f.name as folder_name 
            FROM group_messages gm 
            JOIN users u ON gm.user_id = u.id 
            JOIN folders f ON gm.folder_id = f.id 
            WHERE gm.message LIKE '%' || ? || '%' 
            ORDER BY gm.created_at DESC LIMIT 100`,
    [req.query.q],
    (err, results) => {
      res.json({ results: results || [] });
    }
  );
});

// ========== СМЕНЫ ==========

// Проверка активной смены (запрет на повторную отметку)
app.get("/api/active-check", authMiddleware, (req, res) => {
  const today = new Date().toISOString().split("T")[0];
  db.get(
    `SELECT id FROM time_entries WHERE user_id = ? AND date = ? AND status = 'active'`,
    [req.userId, today],
    (err, shift) => {
      res.json({ hasActiveShift: !!shift });
    }
  );
});

// Начало смены (с проверкой на повторную отметку)
app.post("/api/clock/in", authMiddleware, (req, res) => {
  const today = new Date().toISOString().split("T")[0];
  const now = new Date();
  const hours = now.getHours();
  const isLate = hours >= 10;
  const lateMinutes = isLate ? (hours - 10) * 60 + now.getMinutes() : 0;

  db.get(
    `SELECT id FROM time_entries WHERE user_id = ? AND date = ? AND status IN ('active', 'pending')`,
    [req.userId, today],
    (err, existing) => {
      if (existing) {
        return res
          .status(400)
          .json({ error: "У вас уже есть открытая смена сегодня!" });
      }
      db.run(
        `INSERT INTO time_entries (user_id, clock_in, date, status, is_late, late_minutes) VALUES (?, ?, ?, 'active', ?, ?)`,
        [
          req.userId,
          new Date().toISOString(),
          today,
          isLate ? 1 : 0,
          lateMinutes,
        ],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({
            success: true,
            message: isLate
              ? `Смена отмечена (опоздание ${lateMinutes} мин)`
              : "Смена отмечена",
          });
        }
      );
    }
  );
});

// Завершение смены (сотрудник)
app.post("/api/clock/out", authMiddleware, (req, res) => {
  const today = new Date().toISOString().split("T")[0];
  db.get(
    `SELECT id FROM time_entries WHERE user_id = ? AND date = ? AND status = 'active'`,
    [req.userId, today],
    (err, shift) => {
      if (!shift) return res.status(400).json({ error: "Нет активной смены" });
      db.run(
        `UPDATE time_entries SET clock_out = ?, status = 'completed' WHERE id = ?`,
        [new Date().toISOString(), shift.id],
        () => res.json({ success: true })
      );
    }
  );
});

// Принудительное завершение смены (админ)
app.put("/api/clock/force-stop/:entryId", authMiddleware, (req, res) => {
  if (req.userRole !== "admin") {
    return res.status(403).json({ error: "Только администратор" });
  }
  const { entryId } = req.params;
  db.run(
    `UPDATE time_entries SET clock_out = datetime('now'), status = 'completed', forced_stop = 1 WHERE id = ?`,
    [entryId],
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ success: true, message: "Смена принудительно завершена" });
    }
  );
});

// Получить все активные смены (для админа)
app.get("/api/active-shifts", authMiddleware, (req, res) => {
  if (req.userRole !== "admin") {
    return res.status(403).json({ error: "Только администратор" });
  }
  const today = new Date().toISOString().split("T")[0];
  db.all(
    `SELECT te.id, te.user_id, te.clock_in, u.full_name, u.role, 
            COALESCE(u.avatar_file, u.avatar) as avatar 
            FROM time_entries te 
            JOIN users u ON te.user_id = u.id 
            WHERE te.date = ? AND te.status = 'active' 
            ORDER BY te.clock_in`,
    [today],
    (err, shifts) => {
      res.json({ shifts: shifts || [] });
    }
  );
});

// Удалить смену (админ)
app.delete("/api/time-entry/:entryId", authMiddleware, (req, res) => {
  if (req.userRole !== "admin")
    return res.status(403).json({ error: "Только администратор" });
  db.run(`DELETE FROM time_entries WHERE id = ?`, [req.params.entryId], () =>
    res.json({ success: true })
  );
});

// Табель
app.get("/api/timesheet", authMiddleware, (req, res) => {
  const { startDate, endDate } = req.query;
  let query = `SELECT te.*, u.full_name, u.role FROM time_entries te 
                 JOIN users u ON te.user_id = u.id 
                 WHERE te.date BETWEEN ? AND ? 
                 ORDER BY te.date DESC`;
  let params = [startDate, endDate];
  if (req.userRole === "employee") {
    query += ` AND te.user_id = ?`;
    params.push(req.userId);
  }
  db.all(query, params, (err, data) => {
    res.json({ data: data || [] });
  });
});

// Экспорт (для совместимости)
app.get("/api/export-timesheet", authMiddleware, (req, res) => {
  const { startDate, endDate } = req.query;
  let query = `SELECT te.*, u.full_name, u.role FROM time_entries te 
                 JOIN users u ON te.user_id = u.id 
                 WHERE te.date BETWEEN ? AND ? 
                 ORDER BY te.date DESC`;
  let params = [startDate, endDate];
  if (req.userRole === "employee") {
    query += ` AND te.user_id = ?`;
    params.push(req.userId);
  }
  db.all(query, params, (err, data) => {
    res.json({ data: data || [] });
  });
});

// Кто на смене
app.get("/api/who-is-working", authMiddleware, (req, res) => {
  const today = new Date().toISOString().split("T")[0];
  db.all(
    `SELECT u.id, u.full_name, u.role, COALESCE(u.avatar_file, u.avatar) as user_avatar, te.clock_in, te.status 
            FROM time_entries te 
            JOIN users u ON te.user_id = u.id 
            WHERE te.date = ? AND te.status = 'active' 
            ORDER BY te.clock_in`,
    [today],
    (err, working) => {
      res.json({ working: working || [] });
    }
  );
});

// Переработка
app.post("/api/overtime-request", authMiddleware, (req, res) => {
  const { hours, reason, date } = req.body;
  db.run(
    `INSERT INTO time_entries (user_id, clock_in, clock_out, date, status, overtime_hours, overtime_approved, overtime_request) 
            VALUES (?, datetime('now'), datetime('now', '+' || ? || ' hours'), ?, 'overtime_request', ?, 0, ?)`,
    [
      req.userId,
      hours,
      date || new Date().toISOString().split("T")[0],
      hours,
      reason || "Переработка",
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, message: "Запрос отправлен" });
    }
  );
});

// Уведомления
app.get("/api/notifications", authMiddleware, (req, res) => {
  db.all(
    `SELECT * FROM notifications WHERE user_id = ? AND is_read = 0 ORDER BY created_at DESC LIMIT 50`,
    [req.userId],
    (err, notif) => {
      res.json({ notifications: notif || [] });
    }
  );
});

// Статистика
app.get("/api/stats", authMiddleware, (req, res) => {
  const today = new Date().toISOString().split("T")[0];
  db.get(
    `SELECT COUNT(*) as count FROM group_messages WHERE date(created_at) = ?`,
    [today],
    (err, todayMessages) => {
      db.get(
        `SELECT COUNT(*) as count FROM time_entries WHERE date = ? AND status = 'completed'`,
        [today],
        (err, todayShifts) => {
          db.all(
            `SELECT date, COUNT(*) as count FROM time_entries WHERE status = 'completed' GROUP BY date ORDER BY date DESC LIMIT 7`,
            (err, weeklyShifts) => {
              res.json({
                stats: {
                  todayMessages: todayMessages?.count || 0,
                  todayShifts: todayShifts?.count || 0,
                  weeklyShifts: weeklyShifts || [],
                },
              });
            }
          );
        }
      );
    }
  );
});

// Календарь
app.get("/api/schedule", authMiddleware, (req, res) => {
  const { month, year } = req.query;
  const startDate = `${year}-${month.padStart(2, "0")}-01`;
  const endDate = `${year}-${month.padStart(2, "0")}-31`;
  db.all(
    `SELECT te.*, u.full_name, u.role FROM time_entries te 
            JOIN users u ON te.user_id = u.id 
            WHERE te.date BETWEEN ? AND ? 
            ORDER BY te.date, te.clock_in`,
    [startDate, endDate],
    (err, entries) => {
      res.json({ schedule: entries || [] });
    }
  );
});

app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/avatars", express.static(path.join(__dirname, "public", "avatars")));
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/manifest.json", (req, res) => {
  res.json({
    name: "Хищник Бургерс",
    short_name: "SteakHouse",
    description: "Корпоративная система",
    start_url: "/",
    display: "standalone",
    theme_color: "#ff9800",
    background_color: "#1a1a2e",
    icons: [{ src: "/logo.png", sizes: "192x192", type: "image/png" }],
  });
});

// ========== WEBSOCKET ==========
const server = http.createServer(app);
const clients = new Map();

try {
  const WebSocket = require("ws");
  const wss = new WebSocket.Server({ server });
  wss.on("connection", (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get("token");
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        clients.set(decoded.userId, ws);
        ws.on("close", () => clients.delete(decoded.userId));
      } catch (e) {
        ws.close();
      }
    }
  });
} catch (e) {}

server.listen(PORT, "0.0.0.0", () => {
  console.log("\n========================================");
  console.log("🦁 ХИЩНИК БУРГЕРС");
  console.log("========================================");
  console.log("🌐 http://localhost:" + PORT);
  console.log("\n📋 ДАННЫЕ ДЛЯ ВХОДА:");
  console.log("   admin        / admin123   (Администратор)");
  console.log("   manager1     / manager123 (Менеджер)");
  console.log("   accountant1  / acc123     (Бухгалтер)");
  console.log("   employee1    / emp123     (Сотрудник)");
  console.log("========================================\n");
});
