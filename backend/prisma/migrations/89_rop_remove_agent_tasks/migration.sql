-- РОП-агент выключен на доработку: снимаем все задачи, которые он когда-либо поставил
-- (их id — в rop_task_plans.items[].taskIds). Перед удалением — копия задач и их вложений
-- в rop_removed_tasks / rop_removed_task_attachments: вернуть можно оттуда.
CREATE TABLE "rop_removed_tasks" AS SELECT t.*, NOW() AS "removed_at" FROM "tasks" t WHERE false;
CREATE TABLE "rop_removed_task_attachments" AS SELECT a.* FROM "task_attachments" a WHERE false;

INSERT INTO "rop_removed_tasks"
SELECT t.*, NOW() FROM "tasks" t
WHERE t."id" IN (
  SELECT jsonb_array_elements_text(item -> 'taskIds')
  FROM "rop_task_plans" p
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p."items") = 'array' THEN p."items" ELSE '[]'::jsonb END) AS item
  WHERE jsonb_typeof(item -> 'taskIds') = 'array'
);

INSERT INTO "rop_removed_task_attachments"
SELECT a.* FROM "task_attachments" a WHERE a."task_id" IN (SELECT "id" FROM "rop_removed_tasks");

DELETE FROM "tasks" WHERE "id" IN (SELECT "id" FROM "rop_removed_tasks");

-- Ничего не должно создать новые задачи через старые кнопки.
UPDATE "rop_task_plans" SET "status" = 'DISCARDED', "updated_at" = NOW() WHERE "status" IN ('DRAFT', 'ASSIGNED');
UPDATE "rop_alerts" SET "status" = 'DECLINED', "reason" = 'Агент выключен на доработку', "decided_at" = NOW() WHERE "status" = 'SENT';
UPDATE "rop_task_actions" SET "status" = 'CANCELED', "decided_at" = NOW() WHERE "status" = 'PENDING';
