import type { ScheduleConfig } from '../types';

export function isItemAvailable(schedule?: ScheduleConfig): { available: boolean; reason?: string } {
  if (!schedule || !schedule.enabled) return { available: true };

  const now = new Date();
  const dayOfWeek = now.getDay(); // 0-6
  const dayConfig = schedule.days[dayOfWeek];

  if (!dayConfig || !dayConfig.active) {
    return { 
      available: false, 
      reason: schedule.message || "Indisponível hoje" 
    };
  }

  const [nowH, nowM] = [now.getHours(), now.getMinutes()];
  const [startH, startM] = dayConfig.startTime.split(':').map(Number);
  const [endH, endM] = dayConfig.endTime.split(':').map(Number);

  const nowTotal = nowH * 60 + nowM;
  const startTotal = startH * 60 + startM;
  const endTotal = endH * 60 + endM;

  if (nowTotal >= startTotal && nowTotal <= endTotal) {
    return { available: true };
  }

  return { 
    available: false, 
    reason: schedule.message || `Disponível das ${dayConfig.startTime} às ${dayConfig.endTime}` 
  };
}
