import { useState } from 'react';
import { motion } from 'framer-motion';
import { Users } from 'lucide-react';
import { useStore } from '../../store';
import { AppApi } from '../../lib/api';

export function PdvTerminalLogin() {
  const login = useStore((state) => state.login);
  const [pin, setPin] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [adminPin, setAdminPin] = useState('');
  const [authorizationMessage, setAuthorizationMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLogin = async () => {
    if (pin.length !== 4) {
      setLoginError('Digite os 4 dígitos do seu PIN.');
      return;
    }
    if (!await login(pin)) {
      setLoginError('PIN incorreto ou computador ainda não autorizado.');
      setPin('');
    }
  };

  const handleAuthorization = async () => {
    if (adminPin.length !== 4 || isSubmitting) {
      setAuthorizationMessage('Digite os 4 dígitos do PIN do superadministrador.');
      return;
    }
    setIsSubmitting(true);
    setAuthorizationMessage('');
    try {
      await AppApi.authorizePdvTerminal(adminPin);
      setAuthorizationMessage('Computador autorizado. Agora entre com o PIN do funcionário.');
      setAdminPin('');
      window.setTimeout(() => {
        setIsAuthorizing(false);
        setAuthorizationMessage('');
      }, 1800);
    } catch (error) {
      setAuthorizationMessage(error instanceof Error ? error.message : 'Não foi possível autorizar este computador.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const message = isAuthorizing ? authorizationMessage : loginError;
  const authorized = authorizationMessage.startsWith('Computador autorizado');
  return (
    <div className="min-h-screen bg-transparent flex items-center justify-center font-['Outfit'] p-4 sm:p-8">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card w-full max-w-md p-6 sm:p-12 border-white/10 shadow-2xl flex flex-col items-center">
        <div className="w-20 h-20 bg-primary/10 rounded-[2rem] flex items-center justify-center text-primary mb-8"><Users size={40} /></div>
        <h2 className="text-3xl font-black italic tracking-tighter mb-2">IDENTIFICAÇÃO <span className="text-primary">PDV</span></h2>
        <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest mb-12 text-center leading-relaxed">
          {isAuthorizing ? 'Use o PIN do superadministrador uma única vez neste computador' : 'Insira seu PIN de acesso para entrar no terminal operacional'}
        </p>
        <div className="w-full space-y-6">
          <div className="relative">
            <input
              type="password"
              name={isAuthorizing ? 'terminal-admin-pin' : 'pin'}
              aria-label={isAuthorizing ? 'PIN do superadministrador para autorizar computador' : 'PIN de acesso do PDV'}
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              value={isAuthorizing ? adminPin : pin}
              onChange={(event) => {
                const value = event.target.value.replace(/\D/g, '').slice(0, 4);
                if (isAuthorizing) {
                  setAdminPin(value);
                  setAuthorizationMessage('');
                } else {
                  setPin(value);
                  setLoginError('');
                }
              }}
              onKeyDown={(event) => event.key === 'Enter' && (isAuthorizing ? handleAuthorization() : handleLogin())}
              className={`w-full glass py-8 px-6 rounded-3xl text-4xl text-center font-black tracking-[0.5em] outline-none border-2 transition-all ${message && !authorized ? 'border-rose-500 text-rose-500' : 'border-white/10 focus:border-primary'}`}
              placeholder="****"
              maxLength={4}
              autoFocus
            />
            {message && <p role="alert" className={`mt-4 text-center text-[10px] font-black uppercase ${authorized ? 'text-emerald-400' : 'text-rose-500'}`}>{message}</p>}
          </div>
          <button type="button" onClick={isAuthorizing ? handleAuthorization : handleLogin} disabled={isSubmitting} className="w-full btn-beco btn-beco-purple py-6 text-xl font-black rounded-2xl shadow-2xl shadow-primary/20 disabled:opacity-50">
            {isAuthorizing ? (isSubmitting ? 'AUTORIZANDO...' : 'AUTORIZAR COMPUTADOR') : 'ENTRAR'}
          </button>
          <button
            type="button"
            onClick={() => {
              setIsAuthorizing((current) => !current);
              setAdminPin('');
              setAuthorizationMessage('');
              setLoginError('');
            }}
            className="w-full rounded-2xl border border-white/10 px-4 py-4 text-[11px] font-black uppercase tracking-widest text-zinc-400 transition-colors hover:border-primary/50 hover:text-white"
          >
            {isAuthorizing ? 'Voltar para o acesso da equipe' : 'Autorizar este computador'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
