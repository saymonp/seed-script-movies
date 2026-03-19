import axios from 'axios';
import pkg from 'pg';
const { Client } = pkg;
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";



// --- CONFIGURAÇÕES ---
const TMDB_API_KEY = process.env.TMDB_API_KEY;

const S3_BUCKET = process.env.S3_BUCKET;
const S3_ENDPOINT = process.env.S3_ENDPOINT
const REGION = process.env.REGION
const MinIO_USER = process.env.MINIO_ROOT_USER
const MinIO_PASSWORD = process.env.MinIO_PASSWORD

const DB_USER = process.env.POSTGRES_USER
const DB_PASSWORD = process.env.POSTGRES_PASSWORD
const DB_NAME = process.env.POSTGRES_DB
const DB_ENDPOINT = process.env.POSTGRES_ENDPOINT

const QUANTIDADE_PAGINAS = 1; // Cada página tem 20 filmes (Total: 100)

const tmdb_header = {
    headers: {
        'Authorization': `Bearer ${TMDB_API_KEY}`, "accept": "application/json"
    }
}

async function traduzir(texto, target = 'pt') {
    try {
        const response = await axios.post(
            'https://translation.googleapis.com/language/translate/v2',
            {},
            {
                params: {
                    q: texto,
                    target: target,
                    key: process.env.GOOGLE_API_KEY
                }
            }
        );

        return response.data.data.translations[0].translatedText;

    } catch (error) {
        console.error('Erro ao traduzir:', error.response?.data || error.message);
        return null;
    }
}


async function getMovieDetails(id) {
    // Buscamos detalhes em PT-BR e anexamos os lançamentos (release_dates) e provedores (watch/providers)
    const url = `https://api.themoviedb.org/3/movie/${id}?append_to_response=translations,images,credits&include_image_language=en,pt-BR,null&language=pt-BR`;

    const res = await axios.get(url, tmdb_header);
    const data = res.data;

    const translations = data.translations.translations;

    // 🇧🇷 português (Brasil)
    const ptBR = translations.find(
        t => t.iso_639_1 === 'pt' && t.iso_3166_1 === 'BR'
    );


    // 🇺🇸 inglês (EUA)
    const enUS = translations.find(
        t => t.iso_639_1 === 'en' && t.iso_3166_1 === 'US'
    );

    let descricao_pt;

    // 1. Se já tem em português → usa
    if (ptBR?.data?.overview) {
        descricao_pt = ptBR.data.overview;

        // 2. Se não tem PT, mas tem inglês → traduz
    } else if (enUS?.data?.overview) {
        descricao_pt = await traduzir(enUS.data.overview);

        // 3. Se não tem nada → null
    } else {
        descricao_pt = null;
    }

    return {
        tmdb_id: data.id,

        titulo_original: data.original_title || null,

        // 🇧🇷
        titulo_br: ptBR?.data?.title || null,
        descricao_br: descricao_pt,
        tagline_br: data.tagline || null,

        // 🇺🇸
        titulo_en: enUS?.data?.title || data.original_title || null,
        descricao_en: enUS?.data?.overview || data.overview || null,
        tagline_en: enUS.data.tagline || null,

        rating: data.vote_average || null,
        duracao: data.runtime || null,

        //generos: data.genres?.map(g => g.name).join(', ') || null,
        generos: data.genres || [],

        pais_origem: data.origin_country?.join(', ') || null,
        lingua_origem: data.original_language || null,

        estudio: data.production_companies?.[0]?.name || null,

        poster_path_br: data.poster_path || null,
        backdrop_path_br: data.backdrop_path || null,

        poster_path_us: data.poster_path || null,
        backdrop_path_us: data.backdrop_path || null,

        diretor: data.credits?.crew?.find(c => c.job === 'Director')?.name || null,

        homepage: data.homepage || null,

        belongs_to_collection: data.belongs_to_collection || null
    };
}


async function handleColecao(client, collection) {
    // Se o filme não pertencer a nenhuma coleção, paramos aqui.
    if (!collection || !collection.id) return null;

    try {
        // 1. Primeiro, baixamos as imagens da coleção para o SEU S3
        // (Usando a função uploadToMinio que criamos anteriormente)
        const s3Poster = await uploadToMinio(collection.poster_path, 'collections/posters');
        const s3Backdrop = await uploadToMinio(collection.backdrop_path, 'collections/backdrops');

        // 2. Inserimos ou Atualizamos a coleção no Postgres
        // O "ON CONFLICT" garante que não teremos erro se a coleção já existir
        const query = `
            INSERT INTO colecoes (tmdb_id, nome, poster_path, backdrop_path)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (tmdb_id) 
            DO UPDATE SET 
                nome = EXCLUDED.nome,
                poster_path = EXCLUDED.poster_path,
                backdrop_path = EXCLUDED.backdrop_path
            RETURNING id;
        `;

        const res = await client.query(query, [
            collection.id,      // tmdb_id
            collection.name,    // nome
            s3Poster,           // URL do seu S3
            s3Backdrop          // URL do seu S3
        ]);

        // Retornamos o ID interno (SERIAL) para ser usado na FK da tabela movies
        return res.rows[0].id;

    } catch (error) {
        console.error(`❌ Erro ao processar coleção ${collection.name}:`, error.message);
        return null;
    }
}


async function uploadToMinio(s3, path, folder) {
    if (!path) return null;

    try {
        const fileName = `${folder}/${path.replace('/', '')}`;
        const imageUrl = `https://image.tmdb.org/t/p/original${path}`;

        // Baixa a imagem da API
        const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });

        // Sobe para o MinIO
        await s3.send(new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: fileName,
            Body: response.data,
            ContentType: 'image/jpeg',
            ACL: 'public-read' // Se o seu bucket permitir
        }));

        // Retorna a URL do seu S3 Local
        return `${S3_ENDPOINT}/${S3_BUCKET}/${fileName}`;
    } catch (error) {
        console.error(`❌ Eroc ao subir imagem ${path}:`, error.message);
        return null;
    }
}

async function getOrCreate(client, tabela, nome) {
    const insertQuery = `
        INSERT INTO ${tabela} (nome)
        VALUES ($1)
        ON CONFLICT (nome) DO NOTHING
        RETURNING id;
    `;

    const res = await client.query(insertQuery, [nome]);

    // Se inseriu, retorna o id
    if (res.rows.length > 0) {
        return res.rows[0].id;
    }

    // Se já existia, busca o id
    const selectQuery = `SELECT id FROM ${tabela} WHERE nome = $1`;
    const selectRes = await client.query(selectQuery, [nome]);

    return selectRes.rows[0].id;
}


async function run() {

    console.log("Iniciando Seed de Filmes...");

    const client = new Client({
        user: DB_USER,
        host: DB_ENDPOINT,
        database: DB_NAME,
        password: DB_PASSWORD,
        port: 5432,
    });

    // Configuração do S3 (MinIO Local)
    const s3 = new S3Client({
        endpoint: S3_ENDPOINT,
        region: REGION,
        credentials: { accessKeyId: MinIO_USER, secretAccessKey: MinIO_PASSWORD },
        forcePathStyle: true,
    });

    try {
        await client.connect();
        console.log("Conectado ao banco. Iniciando Seed...");

        for (let p = 1; p <= QUANTIDADE_PAGINAS; p++) {
            const popular = await axios.get(`https://api.themoviedb.org/3/movie/popular?language=pt-BR&page=${p}`, tmdb_header);

            for (const item of popular.data.results) {
                const movie = await getMovieDetails(item.id);
                await client.query('BEGIN');
                // --- DENTRO DO LOOP DO RUN() ---

                // 1. Processa as imagens (S3)

                const posterBrS3 = await uploadToMinio(s3, movie.poster_path_br, 'posters_br');
                const backdropBrS3 = await uploadToMinio(s3, movie.backdrop_path_br, 'backdrops_br');
                const posterEnS3 = await uploadToMinio(s3, movie.poster_path_us, 'posters_en');
                const backdropEnS3 = await uploadToMinio(s3, movie.backdrop_path_us, 'backdrops_en');

                // 2. Se o filme tiver coleção, sobe as imagens dela também
                if (movie.belongs_to_collection) {
                    const col = movie.belongs_to_collection;
                    col.poster_path = await uploadToMinio(col.poster_path, 'collections/posters');
                    col.backdrop_path = await uploadToMinio(col.backdrop_path, 'collections/backdrops');
                }

                // 1. Trata a Coleção primeiro (por causa da FK)
                let colecaoId = null;
                if (movie.belongs_to_collection) {
                    colecaoId = await handleColecao(client, movie.belongs_to_collection);
                }

                // 2. Insere o Filme principal
                const movieQuery = `
                    INSERT INTO movies (
                        tmdb_id, titulo_original, titulo_br, descricao_br, tagline_br,
                        titulo_en, descricao_en, tagline_en, rating, duracao,
                        lingua_origem, poster_path_br, backdrop_path_br, 
                        poster_path_us, backdrop_path_us, homepage, colecao_id 
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
                    ON CONFLICT (tmdb_id) DO UPDATE 
                    SET rating = EXCLUDED.rating WHERE movies.rating IS DISTINCT FROM EXCLUDED.rating
                    RETURNING id;
                `;

                const movieRes = await client.query(movieQuery, [
                    movie.tmdb_id, movie.titulo_original, movie.titulo_br, movie.descricao_br, movie.tagline_br,
                    movie.titulo_en, movie.descricao_en, movie.tagline_en, movie.rating, movie.duracao,
                    movie.lingua_origem,
                    posterBrS3,    // URL do MinIO
                    backdropBrS3,  // URL do MinIO
                    posterEnS3,    // URL do MinIO
                    backdropEnS3,  // URL do MinIO
                    movie.homepage, colecaoId
                ]);

                const internalMovieId = movieRes.rows[0].id;

                // 3. Relacionamentos (Gêneros, Diretores, Estúdios, Países)

                // Gêneros (Vem como array de objetos no rawData)
                if (movie.genres) {
                    for (const g of movie.genres) {
                        const gId = await getOrCreate(client, 'generos', g.name);
                        await client.query(`INSERT INTO movie_generos (movie_id, genero_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [internalMovieId, gId]);
                    }
                }

                // Diretor
                if (movie.diretor) {
                    const dId = await getOrCreate(client, 'diretores', movie.diretor);
                    await client.query(`INSERT INTO movie_diretores (movie_id, diretor_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [internalMovieId, dId]);
                }

                // Estúdio
                if (movie.estudio) {
                    const eId = await getOrCreate(client, 'estudios', movie.estudio);
                    await client.query(`INSERT INTO movie_estudios (movie_id, estudio_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [internalMovieId, eId]);
                }

                // Países (Vem no movie.pais_origem como string separada por vírgula no seu getMovieDetails)
                if (movie.pais_origem) {
                    const paises = movie.pais_origem.split(', ');
                    for (const pNome of paises) {
                        const pId = await getOrCreate(client, 'paises', pNome);
                        await client.query(`INSERT INTO movie_paises (movie_id, pais_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [internalMovieId, pId]);
                    }
                }

                await client.query('COMMIT');
                console.log(`Processado: ${movie.titulo_br}`);
            }

        }
    } catch (err) {
        console.error("Erro no Seed:", err);
    } finally {
        await client.end();
        console.log("Processo finalizado.");
    }
}


run()