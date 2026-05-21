const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcrypt");

const dbPath = path.join(__dirname, "arizona.db");

async function initDatabase() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, async (err) => {
      if (err) {
        console.error("Ошибка подключения к БД:", err);
        reject(err);
        return;
      }

      console.log("📁 База данных подключена");

      // Создание таблиц
      await createTables(db);
      // Заполнение начальными данными
      await seedData(db);

      resolve(db);
    });
  });
}

async function createTables(db) {
  const queries = [
    // Точки (рестораны)
    `CREATE TABLE IF NOT EXISTS points (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            address TEXT NOT NULL,
            lat REAL,
            lng REAL,
            phone TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,

    // Пользователи
    `CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            full_name TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('employee', 'manager', 'accountant', 'admin')),
            point_id INTEGER,
            email TEXT,
            phone TEXT,
            requires_approval INTEGER DEFAULT 1,
            is_active INTEGER DEFAULT 1,
            reset_token TEXT,
            reset_expires DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME,
            FOREIGN KEY (point_id) REFERENCES points(id)
        )`,

    // Записи о сменах
    `CREATE TABLE IF NOT EXISTS time_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            clock_in DATETIME NOT NULL,
            clock_out DATETIME,
            date DATE NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('pending', 'active', 'completed', 'rejected')),
            clock_in_lat REAL,
            clock_in_lng REAL,
            clock_out_lat REAL,
            clock_out_lng REAL,
            approved INTEGER DEFAULT 0,
            approved_by INTEGER,
            approved_at DATETIME,
            point_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (approved_by) REFERENCES users(id),
            FOREIGN KEY (point_id) REFERENCES points(id)
        )`,

    // Папки (группы чатов)
    `CREATE TABLE IF NOT EXISTS folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            allowed_roles TEXT NOT NULL,
            icon TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,

    // Файлы
    `CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            filepath TEXT NOT NULL,
            folder_id INTEGER NOT NULL,
            uploaded_by INTEGER NOT NULL,
            upload_date DATETIME NOT NULL,
            file_size INTEGER,
            signature TEXT,
            version INTEGER DEFAULT 1,
            parent_version INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (folder_id) REFERENCES folders(id),
            FOREIGN KEY (uploaded_by) REFERENCES users(id)
        )`,

    // Сообщения в группах
    `CREATE TABLE IF NOT EXISTS group_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            folder_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            message TEXT,
            file_id INTEGER,
            created_at DATETIME NOT NULL,
            edited_at DATETIME,
            is_edited INTEGER DEFAULT 0,
            FOREIGN KEY (folder_id) REFERENCES folders(id),
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (file_id) REFERENCES files(id)
        )`,

    // Лог действий
    `CREATE TABLE IF NOT EXISTS action_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            action TEXT NOT NULL,
            details TEXT,
            created_at DATETIME NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )`,

    // Уведомления
    `CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            data TEXT,
            created_at DATETIME NOT NULL,
            is_read INTEGER DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )`,

    // Индексы для ускорения
    `CREATE INDEX IF NOT EXISTS idx_time_entries_date ON time_entries(date)`,
    `CREATE INDEX IF NOT EXISTS idx_time_entries_user ON time_entries(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_time_entries_status ON time_entries(status)`,
    `CREATE INDEX IF NOT EXISTS idx_files_folder ON files(folder_id)`,
    `CREATE INDEX IF NOT EXISTS idx_group_messages_folder ON group_messages(folder_id)`,
    `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_action_logs_created ON action_logs(created_at)`,
  ];

  for (const query of queries) {
    await new Promise((resolve, reject) => {
      db.run(query, (err) => {
        if (err) console.error("Ошибка создания таблицы:", err);
        resolve();
      });
    });
  }
}

async function seedData(db) {
  // Добавление точек (ресторанов)
  const points = [
    {
      name: 'Ресторан "Аризона" Тверская',
      address: "г. Москва, ул. Тверская, д. 15",
      lat: 55.757222,
      lng: 37.615555,
      phone: "+7 (495) 123-45-67",
    },
    {
      name: 'Ресторан "Аризона" Арбат',
      address: "г. Москва, ул. Арбат, д. 20",
      lat: 55.751111,
      lng: 37.59,
      phone: "+7 (495) 234-56-78",
    },
    {
      name: 'Ресторан "Аризона" Патрики',
      address: "г. Москва, Патриаршие пруды, д. 5",
      lat: 55.764722,
      lng: 37.586111,
      phone: "+7 (495) 345-67-89",
    },
  ];

  for (const point of points) {
    await new Promise((resolve) => {
      db.run(
        `INSERT OR IGNORE INTO points (name, address, lat, lng, phone) VALUES (?, ?, ?, ?, ?)`,
        [point.name, point.address, point.lat, point.lng, point.phone],
        resolve
      );
    });
  }

  // Получение ID точек
  const pointRows = await new Promise((resolve) => {
    db.all(`SELECT id, name FROM points`, (err, rows) => resolve(rows || []));
  });

  const pointMap = {};
  pointRows.forEach((p) => {
    pointMap[p.name] = p.id;
  });

  // Создание папок (групп чатов)
  const folders = [
    {
      name: "💬 Общий чат",
      description: "Обсуждение рабочих вопросов",
      allowed_roles: "employee,manager,accountant,admin",
    },
    {
      name: "💰 Бухгалтерия",
      description: "Финансовые документы и отчеты",
      allowed_roles: "manager,accountant,admin",
    },
    {
      name: "📚 Обучение",
      description: "Видеоуроки и инструкции",
      allowed_roles: "employee,manager,accountant,admin",
    },
    {
      name: "🔧 Управление",
      description: "Для менеджеров и администрации",
      allowed_roles: "manager,admin",
    },
    {
      name: "🍽️ Кухня",
      description: "Чат поваров и шеф-повара",
      allowed_roles: "employee,manager,admin",
    },
  ];

  for (const folder of folders) {
    await new Promise((resolve) => {
      db.run(
        `INSERT OR IGNORE INTO folders (name, description, allowed_roles) VALUES (?, ?, ?)`,
        [folder.name, folder.description, folder.allowed_roles],
        resolve
      );
    });
  }

  // Хеширование паролей
  const adminHash = await bcrypt.hash("admin123", 10);
  const managerHash = await bcrypt.hash("manager123", 10);
  const employeeHash = await bcrypt.hash("emp123", 10);
  const accountantHash = await bcrypt.hash("acc123", 10);

  // Пользователи
  const users = [
    {
      username: "admin",
      full_name: "Администратор Системы",
      role: "admin",
      point_id: null,
      email: "admin@arizona.ru",
      phone: "+7 (999) 111-22-33",
      hash: adminHash,
    },
    {
      username: "manager1",
      full_name: "Соколова Ирина Владимировна",
      role: "manager",
      point_id: pointMap['Ресторан "Аризона" Тверская'],
      email: "manager1@arizona.ru",
      phone: "+7 (999) 222-33-44",
      hash: managerHash,
    },
    {
      username: "manager2",
      full_name: "Сидоров Алексей Андреевич",
      role: "manager",
      point_id: pointMap['Ресторан "Аризона" Арбат'],
      email: "manager2@arizona.ru",
      phone: "+7 (999) 333-44-55",
      hash: managerHash,
    },
    {
      username: "accountant1",
      full_name: "Бухгалтер Галина Петровна",
      role: "accountant",
      point_id: null,
      email: "accountant@arizona.ru",
      phone: "+7 (999) 444-55-66",
      hash: accountantHash,
    },
    {
      username: "employee1",
      full_name: "Иванов Дмитрий Сергеевич",
      role: "employee",
      point_id: pointMap['Ресторан "Аризона" Тверская'],
      email: "employee1@arizona.ru",
      phone: "+7 (999) 555-66-77",
      hash: employeeHash,
    },
    {
      username: "employee2",
      full_name: "Козлова Екатерина Владимировна",
      role: "employee",
      point_id: pointMap['Ресторан "Аризона" Тверская'],
      email: "employee2@arizona.ru",
      phone: "+7 (999) 666-77-88",
      hash: employeeHash,
    },
    {
      username: "employee3",
      full_name: "Петров Василий Кузьмич",
      role: "employee",
      point_id: pointMap['Ресторан "Аризона" Арбат'],
      email: "employee3@arizona.ru",
      phone: "+7 (999) 777-88-99",
      hash: employeeHash,
    },
  ];

  for (const user of users) {
    await new Promise((resolve) => {
      db.run(
        `INSERT OR IGNORE INTO users (username, password_hash, full_name, role, point_id, email, phone, requires_approval)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          user.username,
          user.hash,
          user.full_name,
          user.role,
          user.point_id,
          user.email,
          user.phone,
        ],
        resolve
      );
    });
  }

  console.log("✅ Начальные данные загружены");
}

function getDb() {
  return new sqlite3.Database(dbPath);
}

module.exports = { initDatabase, getDb };
