import type Database from "better-sqlite3";
import { uniqueHandle } from "./handle";

// Схема базы. Версия хранится в PRAGMA user_version; чтобы изменить схему, добавьте новую
// миграцию в конец списка (уже применённые не трогайте).
const MIGRATIONS: (string | ((db: Database.Database) => void))[] = [
  /* 1 */ `
  CREATE TABLE users (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    email      TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE cameras (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id      TEXT NOT NULL,
    name    TEXT NOT NULL,
    PRIMARY KEY (user_id, id)
  );

  CREATE TABLE rolls (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- id из справочника плёнок (lib/catalog.ts, FILMS), в базе справочника пока нет
    film_id     TEXT NOT NULL,
    camera_id   TEXT,
    format      TEXT NOT NULL CHECK (format IN ('35', '120')),
    iso         INTEGER,
    year        INTEGER NOT NULL,
    month       INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    -- своё название; NULL — название собирается из плёнки, даты и ISO
    title       TEXT,
    description TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id, camera_id) REFERENCES cameras(user_id, id)
  );
  CREATE INDEX rolls_user ON rolls(user_id);

  CREATE TABLE frames (
    id         TEXT PRIMARY KEY,
    roll_id    INTEGER NOT NULL REFERENCES rolls(id) ON DELETE CASCADE,
    idx        INTEGER NOT NULL,
    w          INTEGER NOT NULL,
    h          INTEGER NOT NULL,
    hue        REAL NOT NULL,
    sat        REAL NOT NULL,
    light      REAL NOT NULL,
    color      TEXT NOT NULL,
    -- удалённый кадр остаётся в базе и на диске, просто не показывается
    deleted_at TEXT,
    UNIQUE (roll_id, idx)
  );
  CREATE INDEX frames_roll ON frames(roll_id);
  `,
  /* 2: вход через Google */ `
  ALTER TABLE users ADD COLUMN google_sub TEXT;
  ALTER TABLE users ADD COLUMN avatar_url TEXT;
  CREATE UNIQUE INDEX users_google_sub ON users(google_sub);

  CREATE TABLE sessions (
    -- sha256 токена из cookie; сам токен в базе не хранится
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  `,
  /* 3: несколько способов входа (Google, Яндекс) у одного пользователя */ `
  CREATE TABLE oauth_accounts (
    provider    TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (provider, provider_id)
  );
  CREATE INDEX oauth_accounts_user ON oauth_accounts(user_id);
  INSERT INTO oauth_accounts (provider, provider_id, user_id)
    SELECT 'google', google_sub, id FROM users WHERE google_sub IS NOT NULL;
  DROP INDEX users_google_sub;
  ALTER TABLE users DROP COLUMN google_sub;
  `,
  /* 4: у каждого свой адрес (/u/handle) и доступ к каждой плёнке */ (db) => {
    db.exec(`
      ALTER TABLE users ADD COLUMN handle TEXT;
      ALTER TABLE rolls ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'link', 'public'));
      -- ключ для ссылки «все, у кого есть ссылка»; новые плёнки получают его при создании
      ALTER TABLE rolls ADD COLUMN share_key TEXT;
      UPDATE rolls SET share_key = lower(hex(randomblob(9)));
      CREATE UNIQUE INDEX rolls_share_key ON rolls(share_key);
    `);
    for (const u of db.prepare("SELECT id, email, name FROM users").all() as { id: number; email: string | null; name: string }[]) {
      db.prepare("UPDATE users SET handle = ? WHERE id = ?").run(uniqueHandle(db, u.email ?? u.name), u.id);
    }
    db.exec("CREATE UNIQUE INDEX users_handle ON users(handle)");
  },
  /* 5: загрузка кадров: резерв номеров, размер файлов, свои плёнки (марки) пользователя */ `
  -- следующий свободный номер кадра; загрузка резервирует номера заранее, чтобы кадры из параллельных
  -- запросов вставали в порядке съёмки и две загрузки в одну плёнку не пересекались
  ALTER TABLE rolls ADD COLUMN next_idx INTEGER NOT NULL DEFAULT 1;
  UPDATE rolls SET next_idx = COALESCE((SELECT MAX(idx) FROM frames WHERE roll_id = rolls.id), 0) + 1;
  -- размер оригинала в байтах (для лимита места на пользователя); у кадров из seed 0
  ALTER TABLE frames ADD COLUMN bytes INTEGER NOT NULL DEFAULT 0;

  -- плёнки (марки), которых нет в справочнике lib/catalog.ts и которые пользователь добавил сам
  CREATE TABLE user_films (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id      TEXT NOT NULL,
    name    TEXT NOT NULL,
    iso     INTEGER,
    PRIMARY KEY (user_id, id)
  );
  `,
  /* 6: импорт кадров по ссылке (Яндекс Диск): задание и его файлы */ `
  CREATE TABLE imports (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    roll_id    INTEGER NOT NULL REFERENCES rolls(id) ON DELETE CASCADE,
    source     TEXT NOT NULL,
    source_url TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX imports_user ON imports(user_id);

  -- задание закончено, когда не осталось файлов в состояниях queued и working
  CREATE TABLE import_items (
    import_id TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
    pos       INTEGER NOT NULL,
    name      TEXT NOT NULL,
    path      TEXT NOT NULL,
    size      INTEGER NOT NULL,
    -- номер кадра в плёнке, зарезервирован при старте
    idx       INTEGER NOT NULL,
    status    TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'working', 'done', 'error')),
    error     TEXT,
    PRIMARY KEY (import_id, pos)
  );
  `,
  /* 7: импорт в два шага: сначала быстрые уменьшенные копии, потом оригиналы */ `
  -- кадр показан по временной копии (уменьшенной, от источника), оригинал ещё не принят
  ALTER TABLE frames ADD COLUMN provisional INTEGER NOT NULL DEFAULT 0;

  -- состояние файла теперь знает шаг «показан по копии» (preview); задания короткие, старые не нужны
  DROP TABLE import_items;
  DELETE FROM imports;
  CREATE TABLE import_items (
    import_id TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
    pos       INTEGER NOT NULL,
    name      TEXT NOT NULL,
    path      TEXT NOT NULL,
    size      INTEGER NOT NULL,
    idx       INTEGER NOT NULL,
    -- queued: ещё ничего; preview: кадр уже в плёнке по уменьшенной копии; working: качается оригинал
    status    TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'preview', 'working', 'done', 'error')),
    error     TEXT,
    -- адрес уменьшенной копии у источника и кадр, который по ней создан
    preview   TEXT,
    frame_id  TEXT,
    PRIMARY KEY (import_id, pos)
  );
  `,
  /* 8: загрузка с устройства целиком или никак: ушли со страницы до конца — кадры этой загрузки стираются */ `
  CREATE TABLE uploads (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    roll_id    INTEGER NOT NULL,
    -- плёнку создала эта загрузка: при отмене стирается и она
    new_roll   INTEGER NOT NULL,
    -- сколько кадров обещано (startUploadAction): по нему уборщик отличает законченную загрузку от брошенной
    expected   INTEGER NOT NULL,
    touched_at INTEGER NOT NULL
  );
  -- кадр пришёл в незаконченной загрузке; когда загрузка закончена, отметка снимается
  ALTER TABLE frames ADD COLUMN upload_id TEXT;
  CREATE INDEX frames_upload ON frames(upload_id) WHERE upload_id IS NOT NULL;
  `,
  /* 9: кадр можно повернуть; номер версии попадает в адрес картинки, чтобы браузер не показал старую из памяти */ `
  ALTER TABLE frames ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
  `,
  /* 10: плёнку снимали дольше месяца: конец периода съёмки; NULL — сняли за один месяц (year, month) */ `
  ALTER TABLE rolls ADD COLUMN end_year INTEGER;
  ALTER TABLE rolls ADD COLUMN end_month INTEGER CHECK (end_month BETWEEN 1 AND 12);
  `,
  /* 11: доступ «видна всем» убран (страницы автора в меню больше нет): такие плёнки — «по ссылке», их ссылки работают */ `
  UPDATE rolls SET visibility = 'link' WHERE visibility = 'public';
  `,
];

export function migrate(db: Database.Database) {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      const m = MIGRATIONS[v];
      if (typeof m === "string") db.exec(m);
      else m(db);
      db.pragma(`user_version = ${v + 1}`);
    }).immediate();
  }
}
