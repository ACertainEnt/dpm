CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL UNIQUE,
  discord_user_id VARCHAR(32) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customers_telegram_id ON customers(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_customers_discord_id ON customers(discord_user_id);

CREATE TABLE IF NOT EXISTS customer_servers (
  id SERIAL PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL REFERENCES customers(telegram_user_id) ON DELETE CASCADE,
  guild_id VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_customer_server UNIQUE (telegram_user_id, guild_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_servers_telegram_id ON customer_servers(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_customer_servers_guild_id ON customer_servers(guild_id);
