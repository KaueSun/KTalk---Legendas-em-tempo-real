import { useEffect, useState } from 'react';
import { Archive, Download, RefreshCw, Save, Trash2 } from 'lucide-react';
import type { Preferences, Session, Snapshot } from './types';

type Attempt = (action: () => Promise<unknown> | undefined, message?: string) => Promise<unknown>;

export function LibrarySettings({
  state,
  update,
  attempt,
}: {
  state: Snapshot;
  update: (patch: Partial<Preferences>) => void;
  attempt: Attempt;
}) {
  return (
    <section className="settings-card library-settings">
      <div className="section-title">
        <h2>
          <Archive size={19} />
          Histórico e privacidade
        </h2>
        <span className="version-label">KTalk {state.version}</span>
      </div>
      <label className="check-setting">
        <input
          type="checkbox"
          checked={state.preferences.saveHistory}
          disabled={!state.historyAvailable}
          onChange={(event) => update({ saveHistory: event.target.checked })}
        />
        <span>
          <b>Guardar histórico neste computador</b>
          <small>
            Reabra o aplicativo e continue consultando suas sessões. O arquivo é protegido pela sua conta do
            Windows.
          </small>
        </span>
      </label>
      {!state.historyAvailable && (
        <p className="muted">
          A proteção do histórico não está disponível neste ambiente. Use a exportação para guardar uma
          sessão.
        </p>
      )}
      <label className="field">
        <span>Guardar sessões por</span>
        <select
          aria-label="Prazo do histórico"
          disabled={!state.preferences.saveHistory}
          value={state.preferences.retentionDays}
          onChange={(event) => update({ retentionDays: Number(event.target.value) })}
        >
          {[7, 30, 90].map((days) => (
            <option key={days} value={days}>
              {days} dias
            </option>
          ))}
        </select>
      </label>
      <p className="muted">
        Até 2.000 trechos confirmados. Áudio não é gravado. Desativar esta opção apaga a cópia salva e mantém
        a sessão atual na memória. Arquivos exportados ficam sob seu controle.
      </p>
      <div className="maintenance-actions">
        <button
          className="secondary-button"
          disabled={!window.ktalk || state.status !== 'idle'}
          onClick={() => void attempt(() => window.ktalk?.reconnect(), 'Motor reconectado.')}
        >
          <RefreshCw size={15} />
          Reconectar motor
        </button>
        <button
          className="secondary-button"
          disabled={!window.ktalk}
          onClick={() => void attempt(() => window.ktalk?.diagnostics(), 'Diagnóstico salvo.')}
        >
          <Download size={15} />
          Salvar diagnóstico
        </button>
      </div>
      <p className="muted">
        O diagnóstico contém versão, desempenho e códigos de falha. Não inclui áudio, transcrições nem nomes
        dos dispositivos.
      </p>
    </section>
  );
}

export function SessionActions({
  session,
  busy,
  attempt,
  onDeleted,
}: {
  session?: Session;
  busy: boolean;
  attempt: Attempt;
  onDeleted: () => void;
}) {
  const [title, setTitle] = useState(session?.title || '');
  useEffect(() => {
    setTitle(session?.title || '');
  }, [session?.id, session?.title]);
  if (!session) return null;
  return (
    <form
      className="session-actions"
      onSubmit={(event) => {
        event.preventDefault();
        void attempt(() => window.ktalk?.renameSession(session.id, title), 'Nome atualizado.');
      }}
    >
      <input
        aria-label="Nome da sessão"
        value={title}
        maxLength={80}
        placeholder="Dê um nome para esta sessão"
        disabled={busy}
        onChange={(event) => setTitle(event.target.value)}
      />
      <button className="secondary-button" disabled={busy || !title.trim() || !window.ktalk} type="submit">
        <Save size={14} />
        Salvar nome
      </button>
      <button
        className="secondary-button danger"
        type="button"
        disabled={busy || !window.ktalk}
        onClick={() =>
          void attempt(() => window.ktalk?.deleteSession(session.id), 'Sessão excluída.').then((result) => {
            if (result) onDeleted();
          })
        }
      >
        <Trash2 size={14} />
        Excluir sessão
      </button>
      {session.interrupted && <small>Sessão interrompida · trechos confirmados preservados</small>}
    </form>
  );
}
