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

-- ---------- conteudo editavel ----------
CREATE TABLE IF NOT EXISTS fontes (
  id      TEXT PRIMARY KEY,
  rotulo  TEXT NOT NULL,
  url     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS categorias (
  id     TEXT PRIMARY KEY,
  nome   TEXT NOT NULL,
  cor    TEXT NOT NULL,
  ordem  INT  NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS aneis (
  nivel  INT PRIMARY KEY,
  nome   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tipos_vinculo (
  id    TEXT PRIMARY KEY,
  nome  TEXT NOT NULL,
  cor   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS barras (
  id     BIGSERIAL PRIMARY KEY,
  rotulo TEXT NOT NULL,
  valor  NUMERIC(10,2) NOT NULL,
  nota   TEXT,
  ordem  INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS fases (
  ordem      INT PRIMARY KEY,
  tag        TEXT NOT NULL,
  titulo     TEXT NOT NULL,
  subtitulo  TEXT
);
CREATE TABLE IF NOT EXISTS eventos (
  id         BIGSERIAL PRIMARY KEY,
  fase       INT  NOT NULL REFERENCES fases(ordem) ON DELETE CASCADE,
  ordem      INT  NOT NULL DEFAULT 0,
  data_txt   TEXT NOT NULL,
  categoria  TEXT NOT NULL,
  quem       TEXT NOT NULL,
  texto      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS verbetes (
  id         TEXT PRIMARY KEY,
  nome       TEXT NOT NULL,
  sigla      TEXT NOT NULL,
  papel      TEXT NOT NULL,
  categoria  TEXT NOT NULL,
  anel       INT  NOT NULL,
  info       TEXT NOT NULL,
  fontes     TEXT[] NOT NULL DEFAULT '{}',
  wiki       TEXT,
  ordem      INT  NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS vinculos (
  id       BIGSERIAL PRIMARY KEY,
  origem   TEXT NOT NULL,
  destino  TEXT NOT NULL,
  tipo     TEXT NOT NULL,
  info     TEXT NOT NULL,
  fontes   TEXT[] NOT NULL DEFAULT '{}',
  ordem    INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS vinculos_origem_idx  ON vinculos (origem);
CREATE INDEX IF NOT EXISTS vinculos_destino_idx ON vinculos (destino);
CREATE INDEX IF NOT EXISTS eventos_fase_idx     ON eventos (fase, ordem);

CREATE TABLE IF NOT EXISTS errata (
  id         BIGSERIAL PRIMARY KEY,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  entidade   TEXT NOT NULL,
  registro   TEXT NOT NULL,
  rotulo     TEXT,
  acao       TEXT NOT NULL,
  campo      TEXT,
  antes      TEXT,
  depois     TEXT,
  motivo     TEXT,
  publico    BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS errata_criado_idx ON errata (criado_em DESC);

CREATE TABLE IF NOT EXISTS meta (
  chave  TEXT PRIMARY KEY,
  valor  TEXT NOT NULL
);

-- ---------- direito de resposta / notas dos citados ----------
CREATE TABLE IF NOT EXISTS respostas (
  id          BIGSERIAL PRIMARY KEY,
  verbete     TEXT NOT NULL REFERENCES verbetes(id) ON DELETE CASCADE,
  autor       TEXT NOT NULL,
  tipo        TEXT NOT NULL,
  data_txt    TEXT NOT NULL,
  texto       TEXT NOT NULL,
  fonte       TEXT,
  url         TEXT,
  prioridade  BOOLEAN NOT NULL DEFAULT true,
  ordem       INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS respostas_verbete_idx ON respostas (verbete);

-- ---------- glossario ----------
CREATE TABLE IF NOT EXISTS glossario (
  id         TEXT PRIMARY KEY,
  termo      TEXT NOT NULL,
  variantes  TEXT[] NOT NULL DEFAULT '{}',
  definicao  TEXT NOT NULL,
  verbete    TEXT,
  ordem      INT NOT NULL DEFAULT 0
);

-- ---------- trilhas de dinheiro ----------
CREATE TABLE IF NOT EXISTS trilhas (
  id      TEXT PRIMARY KEY,
  nome    TEXT NOT NULL,
  resumo  TEXT NOT NULL,
  fontes  TEXT[] NOT NULL DEFAULT '{}',
  ordem   INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS passos (
  id        TEXT PRIMARY KEY,
  trilha    TEXT NOT NULL,
  ordem     INT NOT NULL DEFAULT 0,
  de        TEXT NOT NULL,
  de_ref    TEXT,
  para      TEXT NOT NULL,
  para_ref  TEXT,
  valor     TEXT,
  data_txt  TEXT,
  info      TEXT NOT NULL,
  status    TEXT NOT NULL DEFAULT 'apuracao',
  fontes    TEXT[] NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS passos_trilha_idx ON passos (trilha);

-- ---------- metricas de visita (anonimas: sem cookie, sem IP) ----------
-- visitante = hash de (segredo + dia + ip + navegador); muda todo dia, nao identifica ninguem.
CREATE TABLE IF NOT EXISTS metricas (
  id         BIGSERIAL PRIMARY KEY,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  dia        DATE NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  visitante  TEXT NOT NULL,
  tipo       TEXT NOT NULL,
  alvo       TEXT,
  ref        TEXT,
  disp       TEXT
);
CREATE INDEX IF NOT EXISTS metricas_dia_tipo_idx ON metricas (dia, tipo);

-- ---------- monitor de noticias ----------
-- veiculos: onde procurar. rss = feeds proprios separados por espaco; busca = usar Google News com site:
CREATE TABLE IF NOT EXISTS veiculos (
  dominio       TEXT PRIMARY KEY,
  nome          TEXT NOT NULL,
  grupo         TEXT NOT NULL DEFAULT 'outros',
  rss           TEXT,
  busca         BOOLEAN NOT NULL DEFAULT true,
  ativo         BOOLEAN NOT NULL DEFAULT true,
  ultima_coleta TIMESTAMPTZ,
  ultimo_erro   TEXT,
  achadas       INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS noticias (
  id            BIGSERIAL PRIMARY KEY,
  chave         TEXT NOT NULL UNIQUE,
  titulo        TEXT NOT NULL,
  url           TEXT NOT NULL,
  dominio       TEXT,
  veiculo       TEXT,
  resumo        TEXT,
  publicado_em  TIMESTAMPTZ,
  encontrado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  pessoas       TEXT[] NOT NULL DEFAULT '{}',
  via           TEXT,
  status        TEXT NOT NULL DEFAULT 'novo',
  nota          TEXT
);
CREATE INDEX IF NOT EXISTS noticias_status_idx ON noticias (status, publicado_em DESC);
CREATE INDEX IF NOT EXISTS noticias_pessoas_idx ON noticias USING gin (pessoas);

-- ---------- triagem das noticias ----------
-- grupo = id da noticia que representa a mesma historia em varios veiculos
-- categoria/no_site/motivo_ia vem da classificacao por IA e valem para o grupo todo
ALTER TABLE noticias ADD COLUMN IF NOT EXISTS grupo BIGINT;
ALTER TABLE noticias ADD COLUMN IF NOT EXISTS categoria TEXT;
ALTER TABLE noticias ADD COLUMN IF NOT EXISTS no_site TEXT;
ALTER TABLE noticias ADD COLUMN IF NOT EXISTS motivo_ia TEXT;
ALTER TABLE noticias ADD COLUMN IF NOT EXISTS classificado_em TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS noticias_grupo_idx ON noticias (grupo);
CREATE INDEX IF NOT EXISTS noticias_categoria_idx ON noticias (categoria);
