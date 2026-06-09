// migrations.js - idempotent sylibos.db migrations for the Library feature (ESM)
//
// Run once at API boot, before serving. Safe to run on every boot: each ALTER is
// guarded so an already-applied column is a no-op (the same pattern used elsewhere).

export function runLibraryMigrations(db) {
  const addColumn = (sql) => {
    try {
      db.exec(sql)
    } catch (e) {
      if (!/duplicate column name/i.test(e.message)) throw e
    }
  }

  // Marks a course as library-origin and prevents duplicate adds.
  addColumn(`ALTER TABLE courses ADD COLUMN source_slug TEXT`)

  // Per-user lectures need somewhere to hold what we copy from library.db.
  addColumn(`ALTER TABLE lectures ADD COLUMN videos    TEXT NOT NULL DEFAULT '[]'`)
  addColumn(`ALTER TABLE lectures ADD COLUMN assets    TEXT NOT NULL DEFAULT '[]'`)
  addColumn(`ALTER TABLE lectures ADD COLUMN resources TEXT NOT NULL DEFAULT '[]'`)

  // Speeds up the "already added?" lookup and the catalog `added` annotation.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_courses_user_source ON courses(user_id, source_slug)`)
}
