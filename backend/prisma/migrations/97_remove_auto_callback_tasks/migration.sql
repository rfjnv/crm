-- Задачи «Перезвонить» по пропущенным звонкам больше не ставятся автоматически: страница «Задачи»
-- засорялась. Снимаем все такие задачи, которые CRM поставила сама (по описанию «Пропущенный звонок …»;
-- задачи, поставленные вручную кнопкой «Задача «перезвонить»», не трогаем).
-- Перед удалением — копия задач и их вложений в call_removed_tasks / call_removed_task_attachments:
-- вернуть можно оттуда.
CREATE TABLE "call_removed_tasks" AS SELECT t.*, NOW() AS "removed_at" FROM "tasks" t WHERE false;
CREATE TABLE "call_removed_task_attachments" AS SELECT a.* FROM "task_attachments" a WHERE false;

INSERT INTO "call_removed_tasks"
SELECT t.*, NOW() FROM "tasks" t
WHERE t."call_session_id" IS NOT NULL
  AND t."title" LIKE 'Перезвонить: %'
  AND t."description" LIKE 'Пропущенный звонок %';

INSERT INTO "call_removed_task_attachments"
SELECT a.* FROM "task_attachments" a WHERE a."task_id" IN (SELECT "id" FROM "call_removed_tasks");

DELETE FROM "tasks" WHERE "id" IN (SELECT "id" FROM "call_removed_tasks");
