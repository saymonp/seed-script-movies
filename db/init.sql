BEGIN;

CREATE TABLE movies (
    id SERIAL PRIMARY KEY,
    tmdb_id INTEGER UNIQUE NOT NULL,
    titulo_original TEXT,

    titulo_br TEXT,
    descricao_br TEXT,
    tagline_br TEXT,

    titulo_en TEXT,
    descricao_en TEXT,
    tagline_en TEXT,

    rating NUMERIC(3,1),
    duracao INTEGER,

    lingua_origem TEXT,

    -- Imagens BR
    poster_path_br TEXT,      -- Original/High
    poster_thumb_br TEXT,     -- Otimizada 
    backdrop_path_br TEXT,    -- Original/High
    
    -- Imagens US
    poster_path_us TEXT,      -- Original/High
    poster_thumb_us TEXT,     -- Otimizada
    backdrop_path_us TEXT,    -- Original/High

    homepage TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_movies_titulo_br ON movies(titulo_br);
CREATE INDEX idx_movies_titulo_en ON movies(titulo_en);

CREATE TABLE generos (
    id SERIAL PRIMARY KEY,
    nome TEXT UNIQUE
);

CREATE TABLE movie_generos (
    movie_id INTEGER REFERENCES movies(id) ON DELETE CASCADE,
    genero_id INTEGER REFERENCES generos(id),
    PRIMARY KEY (movie_id, genero_id)
);

CREATE TABLE estudios (
    id SERIAL PRIMARY KEY,
    nome TEXT UNIQUE
);

CREATE TABLE movie_estudios (
    movie_id INTEGER REFERENCES movies(id) ON DELETE CASCADE,
    estudio_id INTEGER REFERENCES estudios(id),
    PRIMARY KEY (movie_id, estudio_id)
);

CREATE TABLE diretores (
    id SERIAL PRIMARY KEY,
    nome TEXT UNIQUE
);

CREATE TABLE movie_diretores (
    movie_id INTEGER REFERENCES movies(id) ON DELETE CASCADE,
    diretor_id INTEGER REFERENCES diretores(id),
    PRIMARY KEY (movie_id, diretor_id)
);

CREATE TABLE paises (
    id SERIAL PRIMARY KEY,
    nome TEXT UNIQUE
);

CREATE TABLE movie_paises (
    movie_id INTEGER REFERENCES movies(id) ON DELETE CASCADE,
    pais_id INTEGER REFERENCES paises(id),
    PRIMARY KEY (movie_id, pais_id)
);

CREATE TABLE colecoes (
    id SERIAL PRIMARY KEY,
    tmdb_id INTEGER UNIQUE NOT NULL,
    nome TEXT,
    poster_path TEXT,
    poster_thumb TEXT,
    backdrop_path TEXT
);

-- Adicione uma chave estrangeira na tabela de movies
ALTER TABLE movies ADD COLUMN colecao_id INTEGER REFERENCES colecoes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_movies_poster_thumb_br ON movies(poster_thumb_br);

ALTER TABLE movies
ADD COLUMN slug_pt TEXT,
ADD COLUMN slug_en TEXT;

ALTER TABLE movies 
ADD CONSTRAINT unique_slug_pt UNIQUE (slug_pt),
ADD CONSTRAINT unique_slug_en UNIQUE (slug_en);

ALTER TABLE movies ADD COLUMN release_date DATE;

COMMIT;