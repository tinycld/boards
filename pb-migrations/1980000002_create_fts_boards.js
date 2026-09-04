/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
migrate(
    app => {
        app.db()
            .newQuery(`
                CREATE VIRTUAL TABLE IF NOT EXISTS fts_boards USING fts5(
                    record_id UNINDEXED, title, description, tokenize='porter unicode61'
                )
            `)
            .execute()

        // boards_cards shipped before this index existed, so the sync hooks —
        // which only fire on future writes — would leave every existing card
        // unsearchable. Unlike contacts/drive/mail, whose FTS tables shipped
        // alongside their collections, cards needs an explicit backfill.
        app.db()
            .newQuery(`
                INSERT INTO fts_boards (record_id, title, description)
                SELECT id, title, description FROM boards_cards
            `)
            .execute()
    },
    app => {
        app.db().newQuery('DROP TABLE IF EXISTS fts_boards').execute()
    }
)
