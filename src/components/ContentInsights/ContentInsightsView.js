import React, { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, RefreshCw, Sparkles, Shirt, Clock3, CircleDollarSign, User } from 'lucide-react';
import toast from 'react-hot-toast';

import { fantasyAPI } from '../../services/api';
import contentInsightsService from '../../services/contentInsightsService';
import { extractArray, formatCurrency, getPositionColor, getPositionName } from '../../utils/helpers';
import { findPlayerByNameAndPosition } from '../../utils/playerNameMatcher';
import LoadingSpinner from '../Common/LoadingSpinner';

const VIEW_CONFIG = {
  recommendations: {
    title: 'Recomendaciones',
    description: 'Compras, ventas y tendencias comentadas por José Carrasco.',
    icon: Sparkles,
    accent: 'text-violet-500',
  },
  messi: {
    title: 'Alineación Messi',
    description: 'Jugadores destacados para la jornada, ordenados por demarcación.',
    icon: Shirt,
    accent: 'text-sky-500',
  },
};

const positionForSection = (section) => {
  const value = `${section.category} ${section.title}`.toLowerCase();
  if (value.includes('porter')) return 'portero';
  if (value.includes('defen')) return 'defensa';
  if (value.includes('centro') || value.includes('medio')) return 'centrocampista';
  if (value.includes('delanter') || value.includes('punta')) return 'delantero';
  return '';
};

const formatTimestamp = (seconds) => {
  const total = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(total / 60);
  const remaining = Math.floor(total % 60);
  return `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
};

const budgetLabel = (section) => {
  const min = Number(section.minBudgetMillions);
  const max = Number(section.maxBudgetMillions);
  if (min < 0 && max < 0) return null;
  if (min >= 0 && max >= 0 && min !== max) return `${min}–${max} M€`;
  return `${Math.max(min, max)} M€`;
};

const playerImage = (player) => player?.images?.transparent?.['256x256'] || player?.images?.player || player?.image;

const InsightPlayerCard = ({ item, player, videoUrl }) => {
  const timestampUrl = `${videoUrl}&t=${item.timestampSeconds || 0}s`;
  return (
    <article className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        <div className="w-14 h-14 shrink-0 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden flex items-center justify-center">
          {playerImage(player) ? (
            <img src={playerImage(player)} alt="" className="w-full h-full object-contain" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
          ) : <User className="w-7 h-7 text-gray-400" aria-hidden="true" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-bold text-gray-900 dark:text-white">{player?.nickname || player?.name || item.name}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">{player?.team?.name || item.team || 'Equipo no indicado'}</p>
            </div>
            {player?.positionId && <span className={`text-xs px-2 py-1 rounded-full font-medium ${getPositionColor(player.positionId)}`}>{getPositionName(player.positionId)}</span>}
          </div>
          {player?.marketValue != null && (
            <p className="mt-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <CircleDollarSign className="w-4 h-4" /> {formatCurrency(player.marketValue)}
            </p>
          )}
        </div>
      </div>
      {item.recommendation && <p className="mt-3 text-sm font-semibold text-primary-700 dark:text-primary-300">{item.recommendation}</p>}
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{item.rationale}</p>
      <a href={timestampUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-red-600 dark:text-red-400 hover:underline">
        <Clock3 className="w-4 h-4" /> {formatTimestamp(item.timestampSeconds)} <ExternalLink className="w-3.5 h-3.5" />
      </a>
      {!player && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">No se ha podido vincular con la ficha actual de LaLiga Fantasy.</p>}
    </article>
  );
};

const ContentInsightsView = ({ type }) => {
  const config = VIEW_CONFIG[type];
  const Icon = config.icon;
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const insightsQuery = useQuery({
    queryKey: ['contentInsights', type],
    queryFn: () => contentInsightsService.get(type),
    retry: false,
    staleTime: 30 * 60 * 1000,
  });
  const playersQuery = useQuery({
    queryKey: ['allPlayers'],
    queryFn: () => fantasyAPI.getAllPlayers(),
    staleTime: 10 * 60 * 1000,
  });
  const players = useMemo(() => extractArray(playersQuery.data), [playersQuery.data]);
  const sections = useMemo(() => (insightsQuery.data?.sections || []).map((section) => ({
    ...section,
    players: section.players.map((item) => ({
      ...item,
      fantasyPlayer: findPlayerByNameAndPosition(item.name, positionForSection(section), players, item.team),
    })),
  })), [insightsQuery.data, players]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await contentInsightsService.refresh(type);
      queryClient.setQueryData(['contentInsights', type], result.content);
      toast.success(result.changed ? 'Nuevo vídeo analizado' : 'Ya tienes el último vídeo disponible');
    } catch (error) {
      toast.error(error.code === 'GEMINI_NOT_CONFIGURED'
        ? 'Configura GEMINI_API_KEY en el servidor para generar el primer análisis'
        : (error.message || 'No se pudo actualizar el contenido'));
    } finally {
      setRefreshing(false);
    }
  }, [queryClient, type]);

  if (insightsQuery.isLoading) return <LoadingSpinner fullScreen label={`Cargando ${config.title.toLowerCase()}...`} />;

  const content = insightsQuery.data;
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <header className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Icon className={`w-8 h-8 ${config.accent}`} /> {config.title}
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">{config.description}</p>
        </div>
        <button onClick={handleRefresh} disabled={refreshing} className="btn-primary inline-flex items-center justify-center gap-2 disabled:opacity-60">
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Buscando y analizando…' : 'Actualizar último vídeo'}
        </button>
      </header>

      {!content ? (
        <section className="card p-8 text-center">
          <Icon className={`w-12 h-12 mx-auto ${config.accent}`} />
          <h2 className="mt-3 text-lg font-bold text-gray-900 dark:text-white">Aún no hay un análisis publicado</h2>
          <p className="mt-2 text-gray-500 dark:text-gray-400">Pulsa Actualizar. En Android se descargará la última edición generada por el proceso seguro de GitHub.</p>
        </section>
      ) : (
        <>
          <section className="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-900 text-white">
            <div className="grid md:grid-cols-[280px_1fr]">
              <img src={content.video.thumbnailUrl} alt="" className="w-full h-full min-h-44 object-cover" />
              <div className="p-5 sm:p-6">
                <p className="text-xs uppercase tracking-wider text-gray-400">Vídeo analizado</p>
                <h2 className="mt-1 text-xl font-bold">{content.video.title}</h2>
                <p className="mt-3 text-gray-300">{content.summary}</p>
                <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-gray-400">
                  {content.matchday > 0 && <span>Jornada {content.matchday}</span>}
                  <span>Actualizado {new Date(content.generatedAt).toLocaleString('es-ES')}</span>
                  <a href={content.video.url} target="_blank" rel="noreferrer" className="text-red-400 hover:underline inline-flex items-center gap-1">Ver vídeo <ExternalLink className="w-4 h-4" /></a>
                </div>
              </div>
            </div>
          </section>

          {sections.map((section) => (
            <section key={section.id} className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">{section.title}</h2>
                {budgetLabel(section) && <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 text-xs font-bold">Hasta {budgetLabel(section)}</span>}
              </div>
              {section.subtitle && <p className="text-sm text-gray-500 dark:text-gray-400">{section.subtitle}</p>}
              {section.players.length > 0 && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{section.players.map((item, index) => <InsightPlayerCard key={`${item.name}-${index}`} item={item} player={item.fantasyPlayer} videoUrl={content.video.url} />)}</div>}
              {section.notes?.map((note, index) => <a key={`${note.timestampSeconds}-${index}`} href={`${content.video.url}&t=${note.timestampSeconds}s`} target="_blank" rel="noreferrer" className="block card p-3 text-sm text-gray-600 dark:text-gray-300 hover:border-primary-400"><strong>Nota:</strong> {note.text} <span className="text-primary-600">({formatTimestamp(note.timestampSeconds)})</span></a>)}
            </section>
          ))}

          <p className="text-xs text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 pt-4">Resumen automatizado de opiniones del creador enlazado. Comprueba el fragmento original antes de tomar decisiones en tu liga.</p>
        </>
      )}
    </div>
  );
};

export default ContentInsightsView;
