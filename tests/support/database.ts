import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { unstable_splitSqlQuery } from "wrangler";
export function migrateFixture(db: DatabaseSync) {
  for (const file of readdirSync("migrations").sort())
    for (const sql of unstable_splitSqlQuery(
      readFileSync(`migrations/${file}`, "utf8"),
    ))
      db.exec(sql);
  db.exec(readFileSync("fixtures/seed.sql", "utf8"));
}
export function adaptD1(db: DatabaseSync) {
  return {
    prepare(sql: string) {
      let values: any[] = [];
      const s = {
        bind(...v: any[]) {
          values = v;
          return s;
        },
        async first() {
          return db.prepare(sql).get(...values) ?? null;
        },
        async all() {
          return { results: db.prepare(sql).all(...values) };
        },
        async run() {
          return db.prepare(sql).run(...values);
        },
      };
      return s;
    },
    async batch(statements: { run: () => Promise<unknown> }[]) {
      db.exec("BEGIN");
      try {
        const rows = [];
        for (const s of statements) rows.push(await s.run());
        db.exec("COMMIT");
        return rows;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  } as unknown as D1Database;
}
