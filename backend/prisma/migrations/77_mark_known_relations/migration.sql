-- Свои/союзные компании и конкурент, о которых сказал директор. Только точное совпадение
-- названия: без формы собственности в начале (ООО, МЧЖ, ЧП, ИП, ХК, АО), регистра,
-- пробелов, кавычек и знаков — чтобы не задеть похожих клиентов («ППС Плюс» остаётся клиентом).
UPDATE "clients" SET "relation" = 'AFFILIATE'
WHERE "relation" = 'CUSTOMER'
  AND regexp_replace(
        regexp_replace(lower("company_name"), '^[^[:alnum:]]*(ооо|ooo|мчж|mchj|чп|ип|хк|xk|ао)[^[:alnum:]]+', ''),
        '[^[:alnum:]]', '', 'g'
      ) IN ('базиспринт', 'basisprint', 'ппс', 'pps');

UPDATE "clients" SET "relation" = 'COMPETITOR'
WHERE "relation" = 'CUSTOMER'
  AND regexp_replace(
        regexp_replace(lower("company_name"), '^[^[:alnum:]]*(ооо|ooo|мчж|mchj|чп|ип|хк|xk|ао)[^[:alnum:]]+', ''),
        '[^[:alnum:]]', '', 'g'
      ) IN ('фоилтрейдинг', 'фойлтрейдинг', 'foiltrading');
