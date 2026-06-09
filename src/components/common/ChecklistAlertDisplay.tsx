import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, ClipboardCheck, Clock, X } from 'lucide-react';

type ChecklistAlert = {
  id: string;
  periodo: string;
  percentual: number;
  total: number;
  concluido: number;
  pendente: number;
  atrasados: number;
  horario: string;
  dataOperacional: string;
};

type ChecklistAlertResponse = {
  success: boolean;
  alerts?: ChecklistAlert[];
};

const BEFORE_DUE_SNOOZE_MS = 30 * 60 * 1000;
const OVERDUE_SNOOZE_MS = 2 * 60 * 1000;
const POLL_MS = 60 * 1000;
const DEFAULT_ALERTS_URL = 'https://os.becoartes.com/api/operational/checklist-alerts?slug=becoartes';

function getAlertsUrl() {
  return import.meta.env.VITE_OS_CHECKLIST_ALERTS_URL || DEFAULT_ALERTS_URL;
}

function getSnoozeKey(alertId: string) {
  return `beco_pdv_checklist_alert_snooze_${alertId}`;
}

function isSnoozed(alertId: string, nowMs: number) {
  return Number(localStorage.getItem(getSnoozeKey(alertId)) || 0) > nowMs;
}

function getAlertDueMs(alert: ChecklistAlert) {
  const [hour, minute] = String(alert.horario || '').split(':').map(Number);
  if (!alert.dataOperacional || Number.isNaN(hour) || Number.isNaN(minute)) return Date.now();

  return new Date(`${alert.dataOperacional}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`).getTime();
}

export function ChecklistAlertDisplay() {
  const [alerts, setAlerts] = useState<ChecklistAlert[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;

    async function loadAlerts() {
      try {
        const response = await fetch(getAlertsUrl(), { cache: 'no-store' });
        const payload = await response.json() as ChecklistAlertResponse;
        if (!cancelled && payload.success) setAlerts(payload.alerts || []);
      } catch {
        if (!cancelled) setAlerts([]);
      }
    }

    loadAlerts();
    const pollTimer = window.setInterval(loadAlerts, POLL_MS);
    const wakeTimer = window.setInterval(() => setNowMs(Date.now()), 30 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(pollTimer);
      window.clearInterval(wakeTimer);
    };
  }, []);

  const visibleAlerts = useMemo(() => (
    alerts.filter((alert) => !isSnoozed(alert.id, nowMs))
  ), [alerts, nowMs]);

  const alert = visibleAlerts[0];
  if (!alert) return null;

  function snoozeAlert() {
    const now = Date.now();
    const snoozeMs = now < getAlertDueMs(alert) ? BEFORE_DUE_SNOOZE_MS : OVERDUE_SNOOZE_MS;
    localStorage.setItem(getSnoozeKey(alert.id), String(now + snoozeMs));
    setNowMs(Date.now());
  }

  return (
    <div className="fixed left-4 right-4 bottom-5 z-[1200] pointer-events-none sm:left-auto sm:right-6 sm:max-w-md font-['Outfit']">
      <AnimatePresence>
        <motion.div
          key={alert.id}
          initial={{ opacity: 0, y: 28, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 18, scale: 0.96 }}
          className="pointer-events-auto overflow-hidden rounded-[1.7rem] border border-amber-400/30 bg-[#11100d]/95 shadow-2xl shadow-amber-950/40 backdrop-blur-xl"
        >
          <div className="h-1.5 bg-zinc-800">
            <div className="h-full bg-amber-400 transition-all" style={{ width: `${alert.percentual}%` }} />
          </div>
          <div className="p-5 flex gap-4">
            <div className="mt-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-400/15 text-amber-300">
              <AlertTriangle size={24} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-black uppercase tracking-[0.28em] text-amber-300">Checklist pendente</p>
              <h3 className="mt-1 text-lg font-black uppercase italic tracking-tight text-white">
                {alert.periodo} em {alert.percentual}%
              </h3>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                <span className="flex items-center gap-1.5">
                  <ClipboardCheck size={13} className="text-amber-300" />
                  {alert.concluido}/{alert.total} feitos
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock size={13} className="text-amber-300" />
                  previsto {alert.horario}
                </span>
              </div>
              <p className="mt-3 text-xs font-bold leading-relaxed text-zinc-300">
                Ainda faltam {alert.pendente} item(ns). Antes do horário o aviso pausa por 30 minutos; depois do horário ele volta em 2 minutos.
              </p>
            </div>
            <button
              onClick={snoozeAlert}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-zinc-500 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Ocultar alerta de checklist por 5 minutos"
            >
              <X size={18} />
            </button>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
