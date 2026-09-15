CREATE TABLE IF NOT EXISTS mensagens (
  id             BIGSERIAL PRIMARY KEY,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  tipo           TEXT        NOT NULL,
  nome           TEXT,
  email          TEXT,
  referencia     TEXT,
  mensagem       TEXT        NOT NULL,
  autoriza_pub   BOOLEAN     NOT NULL DEFAULT false,
  ip             TEXT,
  user_agent     TEXT,
  status         TEXT        NOT NULL DEFAULT 'novo',
  nota_interna   TEXT,
  atualizado_em  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS mensagens_criado_idx ON mensagens (criado_em DESC);
CREATE INDEX IF NOT EXISTS mensagens_status_idx ON mensagens (status);
CREATE INDEX IF NOT EXISTS mensagens_tipo_idx   ON mensagens (tipo);
