-- Недозвон, пришедшийся на разговор с этим же номером (клиент был на линии с другим нашим
-- менеджером) или сразу после него (до 5 минут), — не «не перезвонили»: его итог — этот разговор.
UPDATE "call_sessions" AS f
SET "follow_up_call_id" = b."id", "follow_up_at" = b."started_at", "follow_up_direction" = b."direction"
FROM (
  SELECT DISTINCT ON (failed."id") failed."id" AS failed_id, c."id", c."started_at", c."direction"
  FROM "call_sessions" failed
  JOIN "call_sessions" c
    ON c."phone_key" = failed."phone_key"
   AND c."id" <> failed."id"
   AND c."status" = 'COMPLETED'
   AND c."deleted_at" IS NULL
   AND c."started_at" <= failed."started_at"
   AND COALESCE(c."ended_at", c."started_at" + COALESCE(c."duration_sec", 0) * INTERVAL '1 second')
       >= failed."started_at" - INTERVAL '5 minutes'
  WHERE failed."status" IN ('MISSED', 'FAILED')
    AND failed."phone_key" IS NOT NULL
    AND failed."deleted_at" IS NULL
  ORDER BY failed."id", c."started_at" DESC
) AS b
WHERE f."id" = b.failed_id
  AND (f."follow_up_at" IS NULL OR f."follow_up_at" > f."started_at");
