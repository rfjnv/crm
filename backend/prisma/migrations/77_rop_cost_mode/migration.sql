-- Чат РОП-агента с себестоимостью: доступен только при открытом по ПИН доступе.
ALTER TABLE "rop_agent_chats" ADD COLUMN "cost_mode" BOOLEAN NOT NULL DEFAULT false;
