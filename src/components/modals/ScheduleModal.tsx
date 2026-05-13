import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Clock, CheckCircle } from 'lucide-react';
import type { ScheduleConfig } from '../../types';

interface ScheduleModalProps {
  initialConfig?: ScheduleConfig;
  onSave: (config: ScheduleConfig) => void;
  onClose: () => void;
  title: string;
}

const DAYS = [
  'Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'
];

export function ScheduleModal({ initialConfig, onSave, onClose, title }: ScheduleModalProps) {
  const [config, setConfig] = useState<ScheduleConfig>(initialConfig || {
    enabled: false,
    days: {
      0: { active: true, startTime: '00:00', endTime: '23:59' },
      1: { active: true, startTime: '00:00', endTime: '23:59' },
      2: { active: true, startTime: '00:00', endTime: '23:59' },
      3: { active: true, startTime: '00:00', endTime: '23:59' },
      4: { active: true, startTime: '00:00', endTime: '23:59' },
      5: { active: true, startTime: '00:00', endTime: '23:59' },
      6: { active: true, startTime: '00:00', endTime: '23:59' },
    },
    hideTotally: true,
    message: ''
  });

  const toggleDay = (day: number) => {
    setConfig({
      ...config,
      days: {
        ...config.days,
        [day]: { ...config.days[day], active: !config.days[day].active }
      }
    });
  };

  const updateTime = (day: number, field: 'startTime' | 'endTime', value: string) => {
    setConfig({
      ...config,
      days: {
        ...config.days,
        [day]: { ...config.days[day], [field]: value }
      }
    });
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[2000] p-6 font-['Outfit']">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="glass-card w-full max-w-2xl overflow-hidden shadow-2xl border-white/10"
      >
        <div className="p-8 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-primary/20 rounded-2xl flex items-center justify-center text-primary">
              <Clock size={24} />
            </div>
            <div>
              <h3 className="text-2xl font-black tracking-tighter">Agenda de Exibição</h3>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{title}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-3 hover:bg-white/5 rounded-xl text-gray-500 transition-all">
            <X size={24} />
          </button>
        </div>

        <div className="p-8 space-y-8 max-h-[60vh] overflow-y-auto custom-scrollbar">
          {/* Toggle Geral */}
          <div className="flex items-center justify-between p-6 glass rounded-2xl border-white/5">
            <div>
              <p className="font-black text-lg">Ativar Agenda</p>
              <p className="text-xs text-gray-500">Se desativado, o item aparecerá sempre.</p>
            </div>
            <button 
              onClick={() => setConfig({ ...config, enabled: !config.enabled })}
              className={`w-16 h-8 rounded-full transition-all relative ${config.enabled ? 'bg-primary' : 'bg-white/10'}`}
            >
              <div className={`absolute top-1 w-6 h-6 rounded-full bg-white transition-all ${config.enabled ? 'left-9' : 'left-1'}`} />
            </button>
          </div>

          {config.enabled && (
            <>
              <div className="space-y-4">
                <label className="text-[10px] font-black uppercase tracking-widest text-primary ml-1">Configuração por Dia</label>
                <div className="space-y-3">
                  {DAYS.map((dayName, idx) => (
                    <div key={idx} className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${config.days[idx].active ? 'bg-white/[0.03] border-white/10' : 'bg-transparent border-white/5 opacity-50'}`}>
                      <button 
                        onClick={() => toggleDay(idx)}
                        className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all ${config.days[idx].active ? 'bg-primary text-white' : 'bg-white/5 text-gray-500'}`}
                      >
                        {config.days[idx].active ? <CheckCircle size={20} /> : <div className="w-5 h-5 rounded border-2 border-white/20" />}
                      </button>
                      
                      <span className="flex-1 font-bold text-sm">{dayName}</span>

                      {config.days[idx].active && (
                        <div className="flex items-center gap-2">
                          <input 
                            type="time" 
                            value={config.days[idx].startTime} 
                            onChange={(e) => updateTime(idx, 'startTime', e.target.value)}
                            className="bg-black/40 border border-white/10 rounded-lg p-2 text-xs font-bold outline-none focus:border-primary"
                          />
                          <span className="text-gray-500 text-[10px] font-black uppercase">até</span>
                          <input 
                            type="time" 
                            value={config.days[idx].endTime} 
                            onChange={(e) => updateTime(idx, 'endTime', e.target.value)}
                            className="bg-black/40 border border-white/10 rounded-lg p-2 text-xs font-bold outline-none focus:border-primary"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 ml-1">Comportamento fora do horário</label>
                  <select 
                    value={config.hideTotally ? 'hide' : 'show'}
                    onChange={(e) => setConfig({ ...config, hideTotally: e.target.value === 'hide' })}
                    className="w-full glass p-4 rounded-xl border-white/10 font-bold text-xs bg-transparent outline-none"
                  >
                    <option value="hide" className="bg-[#0a0a0c]">Ocultar Totalmente</option>
                    <option value="show" className="bg-[#0a0a0c]">Mostrar como Indisponível</option>
                  </select>
                </div>
                <div className="space-y-3">
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 ml-1">Mensagem de Indisponibilidade</label>
                  <input 
                    placeholder="Ex: Disponível apenas no almoço"
                    value={config.message}
                    onChange={(e) => setConfig({ ...config, message: e.target.value })}
                    className="w-full glass p-4 rounded-xl border-white/10 font-bold text-xs outline-none focus:border-primary"
                  />
                </div>
              </div>
            </>
          )}
        </div>

        <div className="p-8 border-t border-white/5 bg-white/[0.02] flex gap-4">
          <button onClick={onClose} className="flex-1 py-4 glass rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-white/5 transition-all">Cancelar</button>
          <button onClick={() => onSave(config)} className="flex-1 py-4 btn-beco-purple rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-primary/20">Salvar Agenda</button>
        </div>
      </motion.div>
    </div>
  );
}
