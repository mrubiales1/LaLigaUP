/**
 * Market Trends Service
 *
 * Thin orchestrator over:
 *   - marketTrendsScraper.js (network + HTML parsing)
 *   - utils/playerNameMatcher.js (normalization + 4-level cache matching)
 *
 * Owns the in-memory `marketValuesCache`, localStorage persistence, and the
 * public surface consumed by components (initialize, refresh,
 * getPlayerMarketTrend, getTrendingPlayers, getMarketStats, etc.).
 */

import {
    normalizePlayerName,
    normalizeTeamName,
    findTrendCacheMatch,
    mapSpecialNameForTrends,
} from '../utils/playerNameMatcher';
import { fetchMarketHtml, fetchMaxProfitableBid, parseMarketData } from './marketTrendsScraper';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const isRateLimitError = (error) =>
    error?.code === 'BID_SCAN_PAUSED' ||
    error?.response?.status === 429 ||
    error?.response?.data?.status === 429;

class MarketTrendsService {
    constructor() {
        this.marketValuesCache = new Map();
        this.lastMarketScrape = null;
        this.CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
        this.BID_CACHE_DURATION = 6 * 60 * 60 * 1000;
        this.BID_REQUEST_INTERVAL = 1500;
        this.STORAGE_KEY = 'laliga_market_trends';
        this.LAST_SCRAPE_KEY = 'laliga_market_trends_timestamp';
        this._bidQueue = Promise.resolve();
        this._bidRequestPromises = new Map();
        this._nextBidRequestAt = 0;
        this._bidBlockedUntil = 0;

        // Load cached data on initialization
        this.loadCachedData();
    }

    /**
     * Load cached data from localStorage
     */
    loadCachedData() {
        try {
            const cachedData = localStorage.getItem(this.STORAGE_KEY);
            const lastScrapeTime = localStorage.getItem(this.LAST_SCRAPE_KEY);

            if (cachedData && lastScrapeTime) {
                this.marketValuesCache = new Map(JSON.parse(cachedData));
                this.lastMarketScrape = new Date(lastScrapeTime);
            }
        } catch (err) {
            console.warn('[marketTrendsService:loadCachedData]', err);
        }
    }

    /**
     * Save data to localStorage
     */
    saveCachedData() {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify([...this.marketValuesCache.entries()]));
            localStorage.setItem(this.LAST_SCRAPE_KEY, this.lastMarketScrape.toISOString());
        } catch (err) {
            console.warn('[marketTrendsService:saveCachedData]', err);
        }
    }

    /**
     * Check if cache needs refresh
     */
    isCacheStale() {
        if (!this.lastMarketScrape) return true;
        return (Date.now() - this.lastMarketScrape.getTime()) > this.CACHE_DURATION;
    }

    /**
     * Fetch market values from futbolfantasy.com via the scraper module
     * and update the in-memory + localStorage caches.
     */
    async fetchMarketValues() {
        try {
            const htmlText = await fetchMarketHtml();
            const newCache = parseMarketData(htmlText);

            if (newCache.size === 0) {
                return {
                    success: false,
                    error: 'No players found in HTML response',
                    playersCount: 0,
                    source: 'failed'
                };
            }

            // Un refresco manual del mercado no debe volver a consultar todas
            // las fichas individuales. Conservamos las pujas aún vigentes por
            // id de FútbolFantasy y solo se renuevan cada seis horas.
            const previousById = new Map();
            for (const previous of this.marketValuesCache.values()) {
                if (previous.futbolFantasyId) previousById.set(previous.futbolFantasyId, previous);
            }
            const now = Date.now();
            for (const current of newCache.values()) {
                const previous = previousById.get(current.futbolFantasyId);
                const fetchedAt = previous?.maxProfitableBidFetchedAt
                    ? new Date(previous.maxProfitableBidFetchedAt).getTime()
                    : 0;
                if (Number.isFinite(previous?.maxProfitableBid) && now - fetchedAt < this.BID_CACHE_DURATION) {
                    current.maxProfitableBid = previous.maxProfitableBid;
                    current.maxProfitableBidFetchedAt = previous.maxProfitableBidFetchedAt;
                }
            }

            this.marketValuesCache = newCache;
            this.lastMarketScrape = new Date();
            this.saveCachedData();

            return {
                success: true,
                playersCount: newCache.size,
                timestamp: this.lastMarketScrape,
                source: 'real'
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                playersCount: 0,
                source: 'failed'
            };
        }
    }

    /**
     * Get player market trend using the centralized 4-level matcher.
     */
    getPlayerMarketTrend(playerName, playerPosition = null, playerTeam = null) {
        if (!playerName) return null;
        return findTrendCacheMatch(playerName, this.marketValuesCache, {
            playerPosition,
            playerTeam,
        });
    }

    /**
     * Cascada estándar de resolución de tendencia para un jugador de la API:
     * apodo con equipo → nombre completo con equipo → apodo sin equipo →
     * nombre completo sin equipo → escaneo por subcadena de la caché.
     * Todas las vistas comparten esta lógica para que un mismo jugador
     * muestre la misma tendencia en toda la app.
     */
    resolveTrendForPlayer(player) {
        if (!player || this.marketValuesCache.size === 0) return null;
        const displayName = player.nickname || player.name;
        if (!displayName) return null;

        const teamName = player.team?.name || null;
        const primaryName = mapSpecialNameForTrends(displayName);
        const secondaryName = player.name && player.nickname && player.name !== player.nickname
            ? mapSpecialNameForTrends(player.name)
            : null;

        let trend = this.getPlayerMarketTrend(primaryName, player.positionId, teamName);
        if (!trend && secondaryName) {
            trend = this.getPlayerMarketTrend(secondaryName, player.positionId, teamName);
        }
        if (!trend) {
            trend = this.getPlayerMarketTrend(primaryName, player.positionId, null);
        }
        if (!trend && secondaryName) {
            trend = this.getPlayerMarketTrend(secondaryName, player.positionId, null);
        }
        if (!trend) {
            trend = this.findTrendBySubstringScan(displayName, player.positionId);
        }
        return trend;
    }

    /**
     * Completa únicamente los jugadores solicitados con la cifra oficial de
     * "Puja máxima rentable" de su ficha de FútbolFantasy. Las respuestas se
     * guardan junto a la caché diaria del mercado; un valor 0 representa
     * "Sin rentabilidad" y también se considera una respuesta válida.
     */
    async hydrateMaxProfitableBids(players, { onProgress } = {}) {
        const collectTrends = () => {
            const collected = [];
            const seenIds = new Set();
            let hasLegacyEntries = false;
            for (const player of players || []) {
                const trend = this.resolveTrendForPlayer(player);
                const id = trend?.futbolFantasyId;
                if (trend && id === undefined) hasLegacyEntries = true;
                if (!id || seenIds.has(id)) continue;
                seenIds.add(id);
                collected.push(trend);
            }
            return { collected, hasLegacyEntries };
        };

        let { collected: trends, hasLegacyEntries } = collectTrends();
        // Las cachés creadas por versiones anteriores no guardaban el id de
        // FútbolFantasy. Se migran solas con un único refresco del mercado.
        if (hasLegacyEntries) {
            const refreshResult = await this.fetchMarketValues();
            if (refreshResult.success) ({ collected: trends } = collectTrends());
        }

        const now = Date.now();
        const pending = trends.filter((trend) => {
            const fetchedAt = trend.maxProfitableBidFetchedAt
                ? new Date(trend.maxProfitableBidFetchedAt).getTime()
                : 0;
            return !Number.isFinite(trend.maxProfitableBid) || now - fetchedAt >= this.BID_CACHE_DURATION;
        });
        let completed = 0;
        let failed = 0;
        let paused = false;
        let unsavedResults = 0;

        onProgress?.({ completed, total: pending.length, paused, failed });
        for (const trend of pending) {
            try {
                trend.maxProfitableBid = await this._fetchMaxProfitableBidQueued(trend.futbolFantasyId);
                trend.maxProfitableBidFetchedAt = new Date().toISOString();
                unsavedResults += 1;
                // localStorage es síncrono: agrupamos escrituras para que el
                // escaneo progresivo tampoco produzca tirones en la interfaz.
                if (unsavedResults >= 5) {
                    this.saveCachedData();
                    unsavedResults = 0;
                }
            } catch (error) {
                if (isRateLimitError(error)) {
                    paused = true;
                    onProgress?.({ completed, total: pending.length, paused, failed });
                    break;
                }
                failed += 1;
            }
            completed += 1;
            onProgress?.({ completed, total: pending.length, paused, failed });
        }
        if (unsavedResults > 0) this.saveCachedData();

        return {
            requested: trends.length,
            total: pending.length,
            fetched: completed - failed,
            completed,
            failed,
            paused,
            available: trends.filter((trend) => Number.isFinite(trend.maxProfitableBid)).length,
        };
    }

    /** Cola global, deduplicada y espaciada. Ante el primer 429 abre un
     * enfriamiento de cinco minutos y no sigue golpeando el servidor. */
    _fetchMaxProfitableBidQueued(futbolFantasyId) {
        const id = String(futbolFantasyId);
        if (this._bidRequestPromises.has(id)) return this._bidRequestPromises.get(id);

        const request = this._bidQueue.then(async () => {
            if (Date.now() < this._bidBlockedUntil) {
                const error = new Error('Profitable bid scan paused');
                error.code = 'BID_SCAN_PAUSED';
                throw error;
            }

            const waitMs = Math.max(0, this._nextBidRequestAt - Date.now());
            if (waitMs > 0) await sleep(waitMs);
            this._nextBidRequestAt = Date.now() + this.BID_REQUEST_INTERVAL;

            try {
                return await fetchMaxProfitableBid(id);
            } catch (error) {
                if (isRateLimitError(error)) this._bidBlockedUntil = Date.now() + 5 * 60 * 1000;
                throw error;
            }
        });

        this._bidQueue = request.catch(() => undefined);
        this._bidRequestPromises.set(id, request);
        request.finally(() => this._bidRequestPromises.delete(id)).catch(() => undefined);
        return request;
    }

    /**
     * Último recurso: escaneo lineal de la caché comparando subcadenas de
     * nombres normalizados dentro de la misma posición. Devuelve la entrada
     * cruda de la caché (misma forma que getPlayerMarketTrend).
     */
    findTrendBySubstringScan(name, positionId) {
        if (!this.marketValuesCache?.size) return null;
        const positionMap = { 1: 'portero', 2: 'defensa', 3: 'mediocampista', 4: 'delantero' };
        const targetPosition = positionMap[positionId];
        if (!targetPosition) return null;

        const normalize = (str) => str?.toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9\s]/g, '').trim();
        const searchName = normalize(name);
        if (!searchName) return null;

        for (const cached of this.marketValuesCache.values()) {
            if (cached.posicion !== targetPosition) continue;
            const cachedName = normalize(cached.originalName || cached.nombre);
            if (cachedName.includes(searchName) || searchName.includes(cachedName)) {
                return cached;
            }
        }
        return null;
    }

    /**
     * Use centralized team name normalization
     */
    normalizeTeamName(teamName) {
        return normalizeTeamName(teamName);
    }

    /**
     * Use centralized player name normalization
     */
    normalizePlayerName(name) {
        return normalizePlayerName(name);
    }

    /**
     * Get all trending players with filters
     */
    getTrendingPlayers(options = {}) {
        const {
            filter = 'all',
            sortBy = 'value_change',
            limit = 50,
            position = null
        } = options;

        let players = Array.from(this.marketValuesCache.values());

        if (position && position !== 'all') {
            const positionMap = {
                1: 'portero', 2: 'defensa', 3: 'mediocampista', 4: 'delantero'
            };
            const targetPosition = positionMap[position] || position;
            players = players.filter(p => p.posicion === targetPosition);
        }

        switch (filter) {
            case 'rising':
                players = players.filter(p => p.diferencia1 > 0);
                break;
            case 'falling':
                players = players.filter(p => p.diferencia1 < 0);
                break;
            case 'stable':
                players = players.filter(p => p.diferencia1 === 0);
                break;
            default:
                break;
        }

        switch (sortBy) {
            case 'percentage_change':
                players.sort((a, b) => Math.abs(b.porcentaje) - Math.abs(a.porcentaje));
                break;
            case 'current_value':
                players.sort((a, b) => b.valor - a.valor);
                break;
            default: // 'value_change'
                players.sort((a, b) => Math.abs(b.diferencia1) - Math.abs(a.diferencia1));
                break;
        }

        return players.slice(0, limit);
    }

    /**
     * Get market statistics
     */
    getMarketStats() {
        const players = Array.from(this.marketValuesCache.values());

        if (players.length === 0) {
            return {
                totalPlayers: 0,
                risingPlayers: 0,
                fallingPlayers: 0,
                stablePlayers: 0,
                averageChange: 0,
                lastUpdate: this.lastMarketScrape
            };
        }

        const risingPlayers = players.filter(p => p.diferencia1 > 0);
        const fallingPlayers = players.filter(p => p.diferencia1 < 0);
        const stablePlayers = players.filter(p => p.diferencia1 === 0);

        const totalChange = players.reduce((sum, p) => sum + p.diferencia1, 0);
        const averageChange = totalChange / players.length;

        return {
            totalPlayers: players.length,
            risingPlayers: risingPlayers.length,
            fallingPlayers: fallingPlayers.length,
            stablePlayers: stablePlayers.length,
            averageChange: averageChange,
            lastUpdate: this.lastMarketScrape,
            risingPercentage: ((risingPlayers.length / players.length) * 100).toFixed(1),
            fallingPercentage: ((fallingPlayers.length / players.length) * 100).toFixed(1)
        };
    }

    /**
     * Initialize service - fetch data if cache is stale.
     * Concurrent callers (several páginas montándose a la vez) comparten la
     * misma promesa para no lanzar scrapes duplicados.
     */
    async initialize() {
        if (this.initialized) {
            return {
                success: true,
                playersCount: this.marketValuesCache.size,
                timestamp: this.lastMarketScrape,
                source: 'already_initialized'
            };
        }

        if (this._initPromise) return this._initPromise;

        this._initPromise = this._doInitialize().finally(() => {
            this._initPromise = null;
        });
        return this._initPromise;
    }

    async _doInitialize() {
        this.loadCachedData();

        if (!this.isCacheStale()) {
            this.initialized = true;
            return {
                success: true,
                playersCount: this.marketValuesCache.size,
                timestamp: this.lastMarketScrape,
                source: 'cache'
            };
        }

        try {
            const result = await this.fetchMarketValues();

            if (result.success || result.playersCount > 0) {
                this.initialized = true;
            }
            return result;
        } catch (error) {
            if (this.marketValuesCache.size > 0) {
                this.initialized = true;
                return {
                    success: true,
                    playersCount: this.marketValuesCache.size,
                    timestamp: this.lastMarketScrape,
                    source: 'cached_fallback'
                };
            }

            return {
                success: false,
                error: error.message,
                playersCount: 0,
                source: 'failed'
            };
        }
    }

    /**
     * Force refresh data
     */
    async refresh() {
        return await this.fetchMarketValues();
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.marketValuesCache.clear();
        this.lastMarketScrape = null;
        localStorage.removeItem(this.STORAGE_KEY);
        localStorage.removeItem(this.LAST_SCRAPE_KEY);
    }
}

// Export singleton instance
const marketTrendsService = new MarketTrendsService();

// Expose for browser console debugging
if (typeof window !== 'undefined') {
    window.marketTrendsService = marketTrendsService;
}

export default marketTrendsService;

// Lazy import helper for code splitting of this heavy service
export const LazyMarketTrendsService = () => import('./marketTrendsService');
