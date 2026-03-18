import axios from 'axios';
import pkg from 'pg';
const { Client } = pkg;
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

import * as fs from 'node:fs';


// --- CONFIGURAÇÕES ---
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const S3_BUCKET = process.env.S3_BUCKET;
const S3_ENDPOINT = process.env.S3_ENDPOINT

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
        imdb_id: data.imdb_id || null,

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

        generos: data.genres?.map(g => g.name).join(', ') || null,

        pais_origem: data.origin_country?.join(', ') || null,
        lingua_origem: data.original_language || null,

        estudio: data.production_companies?.[0]?.name || null,

        poster_path_br: data.poster_path || null,
        backdrop_path_br: data.backdrop_path || null,

        poster_path_us: data.poster_path || null,
        backdrop_path_us: data.backdrop_path || null,

        diretor: data.credits?.crew?.find(c => c.job === 'Director')?.name || null,

        homepage: data.homepage || null
    };
}

async function run() {

    console.log("Iniciando Seed de Filmes...");
    for (let p = 1; p <= QUANTIDADE_PAGINAS; p++) {
        const popular = await axios.get(`https://api.themoviedb.org/3/movie/popular?language=pt-BR&page=${p}`, tmdb_header);
        let i = 1;
        for (const item of popular.data.results) {
            const movie = await getMovieDetails(item.id);

            console.log(`Salvo: ${movie.titulo_br}`);
            fs.writeFileSync(`${i}.json`, JSON.stringify(movie, null, 2), 'utf-8');
            i = i + 1;
        }

    }
}

//run()

const res = await getMovieDetails(1084242);
console.log(res);