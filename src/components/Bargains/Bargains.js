import React, { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Gem, RefreshCw, ShieldCheck, Clock3, LockKeyhole, Euro, ExternalLink, TrendingUp } from 'lucide-react';
import toast from 'react-hot-toast';

import { fantasyAPI } from '../../services/api';
import marketTrendsService from '../../services/marketTrendsService';
import { useAuthStore } from '../../stores/authStore';
import useMarketTrends from '../../hooks/useMarketTrends';
import useModalFlow from '../../hooks/useModalFlow';
import { fetchLeagueClauses } from '../../utils/fetchAllTeamsData';
import { buildBargains, selectProfitableBidCandidates } from '../../utils/bargainUtils';
import { extractArray, formatNumberWithDots, readTeamMoney } from '../../utils/helpers';
import { validateClauseAmount } from '../../utils/validation';
import { invalidateAfterClausePurchase } from '../../utils/cacheInvalidation';

import LoadingSpinner from '../Common/LoadingSpinner';
import EmptyState from '../Common/EmptyState';
import PaymentFlow from '../Clauses/PaymentFlow';
import PaymentConfirmModal from '../Clauses/PaymentConfirmModal';

const THRESHOLD_OPTIONS = [0, 1_000_000, 2_000_000, 3_000_000, 5_000_000];

const STATE_STYLES = {
  open: {
    card: 'border-green-300 dark:border-green-700 bg-green-50/70 dark:bg-green-950/20',
    badge: 'bg-green-600 text-white',
    icon: ShieldCheck,
  },
  soon: {
    card: 'border-yellow-300 dark:border-yellow-700 bg-yellow-50/70 dark:bg-yellow-950/20',
    badge: 'bg-yellow-500 text-gray-950',
    icon: Clock3,
  },
  locked: {
    card: 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50',
    badge: 'bg-gray-500 text-white',
    icon: LockKeyhole,
  },
};

const formatMoney = (value) => `${formatNumberWithDots(Math.round(value || 0))}€`;
const formatSignedMoney = (value) => `${value > 0 ? '+' : value < 0 ? '-' : ''}${formatMoney(Math.abs(value || 0))}`;

const Bargains = () => {
  const leagueId = useAuthStore((state) => state.leagueId);
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const paymentFlow = useModalFlow();
  const [threshold, setThreshold] = useState(2_000_000);
  const [selectedClause, setSelectedClause] = useState(null);
  const [teamMoney, setTeamMoney] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [scanProgress, setScanProgress] = useState({ completed: 0, total: 0, paused: false, failed: 0 });

  const { trendsReady, isLoading: trendsLoading } = useMarketTrends();

  const standingsQuery = useQuery({
    queryKey: ['standings', leagueId],
    queryFn: () => fantasyAPI.getLeagueRanking(leagueId),
    enabled: !!leagueId,
    staleTime: 10 * 60 * 1000,
  });

  const clausesQuery = useQuery({
    queryKey: ['bargainsClauses', leagueId],
    queryFn: () => fetchLeagueClauses(queryClient, leagueId),
    enabled: !!leagueId,
    staleTime: 5 * 60 * 1000,
  });

  const currentTeam = useMemo(() => {
    const userId = user?.userId?.toString();
    return extractArray(standingsQuery.data).find((entry) => {
      const managerId = entry.userId || entry.team?.userId || entry.team?.manager?.id || entry.manager?.id;
      return userId && managerId?.toString() === userId;
    });
  }, [standingsQuery.data, user?.userId]);

  const currentTeamId = currentTeam?.id || currentTeam?.team?.id;
  const rivalClauses = useMemo(
    () => currentTeamId
      ? (clausesQuery.data?.data || []).filter((clause) => String(clause.teamId) !== String(currentTeamId))
      : [],
    [clausesQuery.data, currentTeamId]
  );

  // El detalle individual solo se consulta para jugadores que están subiendo.
  // El mercado principal ya da esta señal en una única petición y evita abrir
  // cientos de fichas que FútbolFantasy marcaría como no rentables.
  const bidCandidates = trendsReady
    ? selectProfitableBidCandidates(
      rivalClauses,
      (player) => marketTrendsService.resolveTrendForPlayer(player)
    )
    : [];

  const playerIdsKey = bidCandidates
    .map((clause) => clause.playerId)
    .sort((a, b) => a - b)
    .join(',');

  const handleScanProgress = useCallback((progress) => {
    setScanProgress(progress);
  }, []);

  const bidsQuery = useQuery({
    queryKey: ['bargainProfitableBids', leagueId, playerIdsKey],
    queryFn: () => marketTrendsService.hydrateMaxProfitableBids(
      bidCandidates.map((item) => item.player),
      { onProgress: handleScanProgress }
    ),
    enabled: trendsReady && bidCandidates.length > 0,
    staleTime: 6 * 60 * 60 * 1000,
  });

  const bargains = buildBargains(
    rivalClauses,
    (player) => marketTrendsService.resolveTrendForPlayer(player),
    threshold
  );

  const counts = bargains.reduce((acc, item) => {
    acc[item.clauseState.key] += 1;
    return acc;
  }, { open: 0, soon: 0, locked: 0 });

  const closePayment = useCallback(() => {
    paymentFlow.close();
    setSelectedClause(null);
    setTeamMoney(null);
  }, [paymentFlow]);

  const toPaymentClause = useCallback((item) => ({
    ...item,
    clausulaAmount: item.clausePrice,
    playerName: item.player?.nickname || item.player?.name || 'Jugador',
    playerImage: item.player?.images?.transparent?.['256x256'] || item.player?.images?.['256x256'] || null,
    teamName: item.player?.team?.name || 'N/D',
    teamBadge: item.player?.team?.badgeColor || null,
  }), []);

  const handlePayClause = useCallback(async (item) => {
    const clause = toPaymentClause(item);
    setSelectedClause(clause);
    setTeamMoney(null);
    paymentFlow.open();
    try {
      if (currentTeamId) {
        const moneyResponse = await fantasyAPI.getTeamMoney(currentTeamId);
        setTeamMoney(readTeamMoney(moneyResponse));
      } else {
        setTeamMoney(undefined);
      }
    } catch (_error) {
      setTeamMoney(undefined);
    }
  }, [currentTeamId, paymentFlow, toPaymentClause]);

  const handleConfirmPayment = useCallback(async () => {
    if (!selectedClause) return;
    paymentFlow.setProcessing(true);
    try {
      if (!leagueId || !selectedClause.playerTeamId || !validateClauseAmount(selectedClause.clausulaAmount)) {
        throw new Error('Datos de cláusula no válidos');
      }
      const response = await fantasyAPI.payBuyoutClause(
        leagueId,
        selectedClause.playerTeamId,
        selectedClause.clausulaAmount
      );
      if (response?.status !== 200 && response?.status !== 204) throw new Error('La compra no se pudo completar');

      if (currentTeamId && selectedClause.teamId) {
        await invalidateAfterClausePurchase(queryClient, leagueId, currentTeamId, selectedClause.teamId);
      }
      await queryClient.invalidateQueries({ queryKey: ['bargainsClauses', leagueId] });
      closePayment();
      toast.success('¡Cláusula pagada con éxito!');
    } catch (error) {
      const apiMessage = error.response?.data?.message || error.response?.data?.error;
      toast.error(apiMessage || error.message || 'Error al pagar la cláusula');
      closePayment();
    } finally {
      paymentFlow.setProcessing(false);
    }
  }, [selectedClause, paymentFlow, leagueId, currentTeamId, queryClient, closePayment]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await marketTrendsService.refresh();
      await clausesQuery.refetch();
      await bidsQuery.refetch();
      toast.success('Chollos actualizados');
    } catch (_error) {
      toast.error('No se pudieron actualizar todos los datos');
    } finally {
      setRefreshing(false);
    }
  }, [clausesQuery, bidsQuery]);

  const isLoading = standingsQuery.isLoading || clausesQuery.isLoading || trendsLoading;

  if (isLoading) return <LoadingSpinner fullScreen label="Buscando chollos y calculando pujas rentables..." />;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Gem className="w-8 h-8 text-emerald-500" aria-hidden="true" /> Chollos
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Cláusulas de rivales próximas a la puja máxima rentable de FútbolFantasy.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Margen máximo
            <select
              value={threshold}
              onChange={(event) => setThreshold(Number(event.target.value))}
              className="block mt-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
            >
              {THRESHOLD_OPTIONS.map((value) => (
                <option key={value} value={value}>{value === 0 ? 'Sin sobreprecio' : `+${value / 1_000_000} M€`}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing || bidsQuery.isFetching}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-medium"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Actualizar
          </button>
        </div>
      </div>

      {bidsQuery.isFetching && scanProgress.total > 0 && (
        <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 p-4">
          <div className="flex items-center justify-between gap-3 text-sm text-blue-800 dark:text-blue-200">
            <span className="font-medium">Analizando pujas de forma gradual…</span>
            <span>{scanProgress.completed}/{scanProgress.total}</span>
          </div>
          <div className="h-2 mt-2 rounded-full bg-blue-100 dark:bg-blue-900 overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${Math.round((scanProgress.completed / scanProgress.total) * 100)}%` }}
            />
          </div>
          <p className="text-xs text-blue-700 dark:text-blue-300 mt-2">
            Una ficha cada 1,5 segundos. Los resultados aparecen y se guardan a medida que llegan.
          </p>
        </div>
      )}

      {(scanProgress.paused || bidsQuery.data?.paused) && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-4 text-sm text-amber-800 dark:text-amber-200">
          FútbolFantasy ha limitado temporalmente las consultas. El escaneo se ha detenido automáticamente y los datos ya obtenidos permanecen guardados. Espera cinco minutos antes de pulsar «Actualizar».
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <div className="rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 p-3 text-center">
          <div className="text-2xl font-bold text-green-700 dark:text-green-300">{counts.open}</div>
          <div className="text-xs sm:text-sm text-green-700 dark:text-green-400">Abiertas</div>
        </div>
        <div className="rounded-xl border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950/30 p-3 text-center">
          <div className="text-2xl font-bold text-yellow-700 dark:text-yellow-300">{counts.soon}</div>
          <div className="text-xs sm:text-sm text-yellow-700 dark:text-yellow-400">Menos de 2 días</div>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-3 text-center">
          <div className="text-2xl font-bold text-gray-700 dark:text-gray-200">{counts.locked}</div>
          <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Cerradas</div>
        </div>
      </div>

      {bargains.length === 0 ? (
        <EmptyState
          icon={Gem}
          title={bidsQuery.isFetching ? 'Analizando posibles chollos' : 'No hay chollos con este margen'}
          description={bidsQuery.isFetching
            ? 'Los resultados irán apareciendo progresivamente sin bloquear el portal.'
            : 'Prueba a ampliar el margen o actualiza los datos del mercado. Los jugadores sin rentabilidad quedan excluidos.'}
        />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {bargains.map((item) => {
            const player = item.player || {};
            const style = STATE_STYLES[item.clauseState.key];
            const StatusIcon = style.icon;
            const image = player.images?.transparent?.['256x256'] || player.images?.['256x256'] || './default-player.png';
            const isSaving = item.difference <= 0;
            return (
              <article key={`${item.teamId}-${item.playerTeamId}`} className={`rounded-2xl border p-4 ${style.card}`}>
                <div className="flex gap-4">
                  <img
                    src={image}
                    alt={player.nickname || player.name}
                    className="w-20 h-20 rounded-xl object-contain bg-white/70 dark:bg-gray-900/50"
                    onError={(event) => { event.currentTarget.src = './default-player.png'; }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h2 className="font-bold text-lg text-gray-900 dark:text-white truncate">{player.nickname || player.name}</h2>
                        <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
                          {player.team?.name || 'Sin equipo'} · {item.ownerName || 'Rival'}
                        </p>
                      </div>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${style.badge}`}>
                        <StatusIcon className="w-3.5 h-3.5" /> {item.clauseState.label}
                        {item.clauseState.timeRemaining ? ` · ${item.clauseState.timeRemaining}` : ''}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
                      <div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">Precio cláusula</div>
                        <div className="font-bold text-gray-900 dark:text-white">{formatMoney(item.clausePrice)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">Puja máx. rentable</div>
                        <div className="font-bold text-emerald-700 dark:text-emerald-300">{formatMoney(item.maxProfitableBid)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{isSaving ? 'Ahorro' : 'Sobreprecio'}</div>
                        <div className={`font-bold ${isSaving ? 'text-green-700 dark:text-green-300' : 'text-amber-700 dark:text-amber-300'}`}>
                          {isSaving ? '-' : '+'}{formatMoney(Math.abs(item.difference))}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">Subida de hoy</div>
                        <div className={`font-bold inline-flex items-center gap-1 ${item.trend?.diferencia1 > 0 ? 'text-green-700 dark:text-green-300' : 'text-gray-600 dark:text-gray-300'}`}>
                          <TrendingUp className="w-4 h-4" />
                          {formatSignedMoney(item.trend?.diferencia1)}
                          {Number.isFinite(item.trend?.porcentaje) && (
                            <span className="text-xs font-medium">({item.trend.porcentaje > 0 ? '+' : ''}{item.trend.porcentaje.toFixed(2)}%)</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-black/10 dark:border-white/10 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    Valor actual: {formatMoney(item.trend?.valor || player.marketValue)}
                  </span>
                  {item.clauseState.isOpen ? (
                    <button
                      type="button"
                      onClick={() => handlePayClause(item)}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold"
                    >
                      <Euro className="w-4 h-4" /> Pagar cláusula
                    </button>
                  ) : (
                    <span className="text-sm text-gray-500 dark:text-gray-400">Pago disponible al desbloquearse</span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
        Fuente de valoración: FútbolFantasy. Para proteger el servicio, solo se consultan fichas individuales de jugadores al alza y las pujas se cachean durante seis horas.
        <a className="inline-flex items-center gap-1 text-primary-600 dark:text-primary-400 hover:underline" href="https://www.futbolfantasy.com/analytics/laliga-fantasy/mercado" target="_blank" rel="noreferrer">
          Ver mercado <ExternalLink className="w-3 h-3" />
        </a>
      </p>

      <PaymentFlow
        isOpen={paymentFlow.isOpen && !paymentFlow.isConfirming}
        clause={selectedClause}
        availableMoney={teamMoney}
        onClose={closePayment}
        onContinue={paymentFlow.confirm}
      />
      <PaymentConfirmModal
        isOpen={paymentFlow.isConfirming}
        clause={selectedClause}
        isProcessing={paymentFlow.isProcessing}
        onClose={closePayment}
        onConfirm={handleConfirmPayment}
      />
    </div>
  );
};

export default Bargains;
