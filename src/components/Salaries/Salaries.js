import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Database,
  RefreshCw,
  Users,
  Wallet,
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { fetchSalaryReport } from '../../services/salaryService';
import { formatCurrency, formatDate, formatNumber } from '../../utils/helpers';
import ErrorDisplay from '../Common/ErrorDisplay';
import LoadingSpinner from '../Common/LoadingSpinner';

const StatCard = ({ icon: Icon, label, value, detail }) => (
  <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-dark-border dark:bg-dark-card">
    <div className="flex items-start gap-3">
      <div className="rounded-lg bg-primary-50 p-2 text-primary-600 dark:bg-primary-500/10 dark:text-primary-300">
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
        <p className="mt-0.5 text-xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
        {detail && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{detail}</p>}
      </div>
    </div>
  </div>
);

const MoneyCell = ({ value, positive = false, negative = false }) => {
  const color = positive
    ? 'text-emerald-600 dark:text-emerald-400'
    : negative
      ? 'text-red-600 dark:text-red-400'
      : 'text-gray-900 dark:text-gray-100';
  return <span className={`font-semibold tabular-nums ${color}`}>{formatCurrency(value)}</span>;
};

const ManagerAvatar = ({ row }) => {
  const [failed, setFailed] = useState(false);
  const initial = row.managerName.charAt(0).toUpperCase();
  return (
    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-primary-300 to-primary-500 text-sm font-bold text-white">
      {row.avatar && !failed
        ? <img src={row.avatar} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} />
        : initial}
    </div>
  );
};

const SalaryRow = ({ row }) => {
  const [open, setOpen] = useState(row.isCurrentUser);
  const reliable = row.reconstructionComplete;

  return (
    <div className={`overflow-hidden rounded-xl border bg-white shadow-sm dark:bg-dark-card ${
      row.isCurrentUser
        ? 'border-primary-300 ring-1 ring-primary-200 dark:border-primary-500 dark:ring-primary-500/30'
        : 'border-gray-200 dark:border-dark-border'
    }`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative grid w-full grid-cols-1 gap-4 p-4 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/60 md:grid-cols-[minmax(190px,1.4fr)_repeat(4,minmax(115px,1fr))_32px] md:items-center"
        aria-expanded={open}
      >
        <div className="flex min-w-0 items-center gap-3">
          <ManagerAvatar row={row} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate font-semibold text-gray-900 dark:text-gray-100">{row.managerName}</p>
              {row.isCurrentUser && (
                <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[11px] font-semibold text-primary-700 dark:bg-primary-500/20 dark:text-primary-200">Tú</span>
              )}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              {reliable
                ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                : <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
              {row.isExactBalance ? 'Saldo oficial' : reliable ? 'Estimación completa' : 'Estimación parcial'}
            </div>
          </div>
        </div>

        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400">Saldo</p>
          <p className={`mt-0.5 text-lg font-bold tabular-nums ${row.displayedBalance < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
            {formatCurrency(row.displayedBalance)}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400">Equipo al entrar</p>
          <p className="mt-0.5 font-semibold tabular-nums text-gray-900 dark:text-gray-100">{formatCurrency(row.startingTeamValue)}</p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">{row.valuedPlayers}/{row.startingPlayers} jugadores valorados</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400">Ingresos</p>
          <p className="mt-0.5"><MoneyCell value={row.income} positive /></p>
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400">Gastos</p>
          <p className="mt-0.5"><MoneyCell value={row.expenses} negative /></p>
        </div>
        <div className="absolute right-7 mt-1 text-gray-400 md:static md:right-auto md:mt-0">
          {open ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-100 bg-gray-50/70 px-4 py-4 dark:border-gray-700 dark:bg-gray-900/30">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Base inicial</p>
              <p className="font-medium text-gray-900 dark:text-gray-100">{formatCurrency(100_000_000)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Ventas al mercado</p>
              <p className="font-medium text-gray-900 dark:text-gray-100">{formatCurrency(row.sales)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Ventas a managers</p>
              <p className="font-medium text-gray-900 dark:text-gray-100">{formatCurrency(row.receivedFromManagers)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Premios de jornada</p>
              <p className="font-medium text-gray-900 dark:text-gray-100">{formatCurrency(row.rewards)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Saldo solo con actividad</p>
              <p className="font-medium text-gray-900 dark:text-gray-100">{formatCurrency(row.observedBalance)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Compensación calibrada</p>
              <p className="font-medium text-gray-900 dark:text-gray-100">{formatCurrency(row.calibratedCompensation)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Valor actual del equipo</p>
              <p className="font-medium text-gray-900 dark:text-gray-100">{formatCurrency(row.currentTeamValue)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Alta en la liga</p>
              <p className="font-medium text-gray-900 dark:text-gray-100">{row.joinedAt ? formatDate(row.joinedAt) : 'No localizada'}</p>
            </div>
          </div>
          {row.isCurrentUser && (
            <p className="mt-4 rounded-lg bg-primary-50 px-3 py-2 text-xs text-primary-800 dark:bg-primary-500/10 dark:text-primary-200">
              Tu saldo se lee directamente de LaLiga Fantasy. La diferencia frente al historial sirve para calibrar la compensación inicial del resto de la liga.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

const Salaries = () => {
  const leagueId = useAuthStore((state) => state.leagueId);
  const user = useAuthStore((state) => state.user);
  const currentManagerId = user?.userId ?? user?.id ?? null;

  const { data: report, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['salaryReport', leagueId, currentManagerId],
    queryFn: () => fetchSalaryReport({ leagueId, currentManagerId }),
    enabled: Boolean(leagueId && currentManagerId),
    retry: false,
    staleTime: 30 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="py-16">
        <LoadingSpinner label="Reconstruyendo plantillas y valores históricos…" />
        <p className="mx-auto -mt-4 max-w-lg text-center text-xs text-gray-500 dark:text-gray-400">
          La primera carga consulta el valor diario de los 14 jugadores iniciales de cada manager y puede tardar unos segundos.
        </p>
      </div>
    );
  }

  if (error) return <ErrorDisplay error={error} onRetry={refetch} title="No se pudieron calcular los salarios" />;
  if (!report) return null;

  const exactRows = report.rows.filter((row) => row.isExactBalance).length;
  const reconstructedRows = report.rows.filter((row) => row.reconstructionComplete).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-primary-100 p-2.5 text-primary-700 dark:bg-primary-500/20 dark:text-primary-200">
              <Wallet className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Salarios</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">Recuento de saldos a partir del historial completo de la liga</p>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-600 disabled:cursor-wait disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          Recalcular
        </button>
      </div>

      <div className={`rounded-xl border p-4 ${
        report.coverage.complete
          ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-100'
          : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100'
      }`}>
        <div className="flex items-start gap-3">
          {report.coverage.complete
            ? <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0" />
            : <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />}
          <div>
            <p className="font-semibold">
              {report.coverage.complete ? 'Historial reconstruido por completo' : 'El cálculo tiene cobertura parcial'}
            </p>
            <p className="mt-1 text-sm opacity-90">
              Se han procesado {formatNumber(report.coverage.activities)} movimientos y {formatNumber(report.coverage.historicalPlayers)} historiales de jugadores.
              {report.coverage.failedMarketHistories.length > 0 && ` Faltan ${report.coverage.failedMarketHistories.length} valores históricos.`}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Users} label="Managers" value={report.rows.length} detail={`${reconstructedRows} plantillas iniciales completas`} />
        <StatCard icon={Database} label="Movimientos" value={formatNumber(report.coverage.activities)} detail={`${report.coverage.pagesLoaded} páginas del historial`} />
        <StatCard icon={CircleDollarSign} label="Saldos oficiales" value={exactRows} detail="La API solo revela el saldo propio" />
        <StatCard
          icon={Wallet}
          label="Umbral inicial calibrado"
          value={report.startingValueReference === null ? 'No disponible' : formatCurrency(report.startingValueReference)}
          detail="Inferido con tu saldo y plantilla inicial"
        />
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-100">
        <p className="font-semibold">Cómo leer el resultado</p>
        <p className="mt-1 leading-relaxed opacity-90">
          Tu fila muestra el saldo oficial. Para los demás se suman 100 M€, ventas, premios y compensación inicial, y se restan compras y cláusulas. La compensación se calibra con tu saldo real y el valor de tu equipo al entrar. Recompensas diarias o aumentos de cláusula que no aparezcan en Actividad pueden producir diferencias en los rivales.
        </p>
      </div>

      <div className="space-y-3">
        {report.rows.map((row) => <SalaryRow key={row.managerId} row={row} />)}
      </div>
    </div>
  );
};

export default Salaries;
