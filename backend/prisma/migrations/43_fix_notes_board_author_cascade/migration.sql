-- Fix: Change notes_board_rows.author_id FK from CASCADE to RESTRICT
-- Previously, deleting a user would silently cascade-delete all their notes board rows.
-- Now deletion is blocked if the user has any notes board rows.
ALTER TABLE "notes_board_rows" DROP CONSTRAINT IF EXISTS "notes_board_rows_author_id_fkey";
ALTER TABLE "notes_board_rows" ADD CONSTRAINT "notes_board_rows_author_id_fkey"
  FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
