/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
// The search index gains a column for a card's custom text (its type's text,
// select and collaborative fields). FTS5 cannot add a column to a virtual
// table, so the table is rebuilt. The backfill leaves `fields` empty: what a
// card's custom values mean depends on its type, which only the Go sync reads,
// and each card's next write fills its row in. A one-off reindex is not worth
// a Go backfill for text no card carried before this release.
migrate(
    app => {
        app.db().newQuery('DROP TABLE IF EXISTS fts_boards').execute()
        app.db()
            .newQuery(`
                CREATE VIRTUAL TABLE fts_boards USING fts5(
                    record_id UNINDEXED, title, description, fields, tokenize='porter unicode61'
                )
            `)
            .execute()
        app.db()
            .newQuery(`
                INSERT INTO fts_boards (record_id, title, description, fields)
                SELECT id, title, description, '' FROM boards_cards
            `)
            .execute()
    },
    app => {
        app.db().newQuery('DROP TABLE IF EXISTS fts_boards').execute()
        app.db()
            .newQuery(`
                CREATE VIRTUAL TABLE fts_boards USING fts5(
                    record_id UNINDEXED, title, description, tokenize='porter unicode61'
                )
            `)
            .execute()
        app.db()
            .newQuery(`
                INSERT INTO fts_boards (record_id, title, description)
                SELECT id, title, description FROM boards_cards
            `)
            .execute()
    }
)
