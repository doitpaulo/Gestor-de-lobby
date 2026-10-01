import React, { useState, useEffect } from 'react';
import { BackupService } from '../services/backupService';
import { StorageService } from '../services/storageService';
import { BackupConfig, BackupSnapshot } from '../types';
import { 
  IconShieldCheck, IconFolder, IconDownload, IconUpload, IconRefresh, 
  IconCheck, IconClock, IconSearch, IconPlus 
} from './Icons';

export const BackupManagementSection: React.FC<{ onDataRestored?: () => void }> = ({ onDataRestored }) => {
  const [config, setConfig] = useState<BackupConfig>(() => BackupService.getConfig());
  const [snapshots, setSnapshots] = useState<BackupSnapshot[]>(() => BackupService.getSnapshots());
  const [searchTerm, setSearchTerm] = useState('');
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [folderPathInput, setFolderPathInput] = useState(config.backupFolder);
  const [selectedFolderHandleName, setSelectedFolderHandleName] = useState<string | null>(null);

  // Modals state
  const [inspectSnapshot, setInspectSnapshot] = useState<BackupSnapshot | null>(null);
  const [restoreConfirmSnapshot, setRestoreConfirmSnapshot] = useState<BackupSnapshot | null>(null);
  const [excelImportResult, setExcelImportResult] = useState<{
    snapshot: BackupSnapshot;
    stats: any;
    fileName: string;
  } | null>(null);
  const [excelRestoreMode, setExcelRestoreMode] = useState<'replace' | 'merge'>('replace');
  const [isProcessingExcel, setIsProcessingExcel] = useState(false);
  const [statusNotification, setStatusNotification] = useState<string | null>(null);

  useEffect(() => {
    // Check and run daily auto backup if needed
    BackupService.checkAndRunDailyBackup();
    refreshData();

    // Event listener for real-time auto backups
    const handleAutoBackup = (event: any) => {
      refreshData();
      const snap: BackupSnapshot = event.detail;
      if (snap) {
        showNotification(`✔ Backup automático registrado (${snap.triggerReason})`);
      }
    };

    window.addEventListener('nexus-auto-backup-completed', handleAutoBackup);
    return () => {
      window.removeEventListener('nexus-auto-backup-completed', handleAutoBackup);
    };
  }, []);

  const refreshData = () => {
    setConfig(BackupService.getConfig());
    setSnapshots(BackupService.getSnapshots());
  };

  const showNotification = (msg: string) => {
    setStatusNotification(msg);
    setTimeout(() => {
      setStatusNotification(null);
    }, 4000);
  };

  const handleSaveConfig = (updated: Partial<BackupConfig>) => {
    const newConfig = { ...config, ...updated };
    setConfig(newConfig);
    BackupService.saveConfig(newConfig);
    showNotification("✔ Configurações de backup atualizadas!");
  };

  const handleCreateManualBackup = () => {
    setIsCreatingBackup(true);
    setTimeout(() => {
      const snap = BackupService.createSnapshot("Backup Manual do Usuário", true);
      setIsCreatingBackup(false);
      refreshData();
      if (snap) {
        showNotification("✔ Backup de segurança gerado com sucesso!");
      } else {
        alert("Não foi possível gerar o backup.");
      }
    }, 300);
  };

  const handleSelectLocalFolder = async () => {
    try {
      if ('showDirectoryPicker' in window) {
        const dirHandle = await (window as any).showDirectoryPicker();
        if (dirHandle) {
          BackupService.setDirHandleInMemory(dirHandle);
          setSelectedFolderHandleName(dirHandle.name);
          handleSaveConfig({ backupFolder: dirHandle.name });
          
          // Trigger automatic initial backup right after setting folder
          const autoSnap = BackupService.createSnapshot(`Backup Automático (Pasta Vinculada: ${dirHandle.name})`, true);
          refreshData();
          showNotification(`✔ Pasta vinculada e backup automático gerado com sucesso: ${dirHandle.name}`);
        }
      } else {
        alert("Seu navegador não possui a API de Seleção de Pasta Nativa em iFrames. Você pode definir o nome da pasta de destino no campo de configurações abaixo.");
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error("Directory picker error:", err);
      }
    }
  };

  const handleUpdateFolderPathName = () => {
    if (!folderPathInput.trim()) return;
    handleSaveConfig({ backupFolder: folderPathInput.trim() });
    BackupService.createSnapshot(`Backup Automático (Pasta Destino Configurada)`, true);
    refreshData();
    showNotification("✔ Pasta de destino configurada e backup automático gerado!");
  };

  const handleExecuteRestore = (snapshot: BackupSnapshot) => {
    const success = BackupService.restoreSnapshot(snapshot);
    if (success) {
      alert(`✔ Restauração concluída com sucesso para a versão de ${snapshot.dateFormatted}! O sistema será recarregado.`);
      if (onDataRestored) onDataRestored();
      window.location.reload();
    } else {
      alert("Erro ao restaurar o backup. Verifique se a estrutura de dados é válida.");
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const lower = file.name.toLowerCase();
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
      handleImportExcelFile(e);
      return;
    }

    const res = await BackupService.importSnapshotFromFile(file);
    if (res.success && res.snapshot) {
      refreshData();
      showNotification("✔ Backup importado com sucesso para a lista de restauração!");
      if (window.confirm("Backup importado com sucesso! Deseja restaurar a ferramenta imediatamente para o ponto deste arquivo?")) {
        handleExecuteRestore(res.snapshot);
      }
    } else {
      alert(res.error || "Erro ao importar arquivo de backup.");
    }
    e.target.value = '';
  };

  const handleImportExcelFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingExcel(true);
    try {
      const res = await BackupService.importSnapshotFromExcel(file);
      if (res.success && res.snapshot) {
        refreshData();
        setExcelImportResult({
          snapshot: res.snapshot,
          stats: res.stats,
          fileName: file.name
        });
        showNotification("✔ Planilha Excel reconhecida com sucesso!");
      } else {
        alert(res.error || "Erro ao reconhecer a planilha Excel.");
      }
    } catch (err: any) {
      alert(`Falha ao ler o arquivo Excel: ${err.message || err}`);
    } finally {
      setIsProcessingExcel(false);
      e.target.value = '';
    }
  };

  const handleExecuteExcelRestore = () => {
    if (!excelImportResult) return;
    const { snapshot, stats } = excelImportResult;

    if (excelRestoreMode === 'replace') {
      const success = BackupService.restoreSnapshot(snapshot);
      if (success) {
        showNotification(`✔ Restauração Concluída! ${stats.tasksCount} demandas salvas no banco de dados.`);
        setExcelImportResult(null);
        window.dispatchEvent(new CustomEvent('nexus-data-restored', { detail: snapshot.dataPayload }));
        if (onDataRestored) onDataRestored();
        refreshData();
      } else {
        showNotification("❌ Ocorreu um erro ao restaurar os dados.");
      }
    } else {
      // Merge mode
      try {
        if (snapshot.dataPayload.TASKS) {
          StorageService.mergeTasks(snapshot.dataPayload.TASKS);
        }
        if (snapshot.dataPayload.DEVS && snapshot.dataPayload.DEVS.length > 0) {
          const currentDevs = StorageService.getDevs();
          const devNames = new Set(currentDevs.map((d: any) => d.name));
          const toAdd = snapshot.dataPayload.DEVS.filter((d: any) => !devNames.has(d.name));
          if (toAdd.length > 0) {
            StorageService.saveDevs([...currentDevs, ...toAdd]);
          }
        }
        showNotification(`✔ Mesclagem Concluída! ${stats.tasksCount} demandas integradas ao banco de dados.`);
        setExcelImportResult(null);
        window.dispatchEvent(new CustomEvent('nexus-data-restored', { detail: snapshot.dataPayload }));
        if (onDataRestored) onDataRestored();
        refreshData();
      } catch (err: any) {
        showNotification(`❌ Erro na mesclagem: ${err.message || err}`);
      }
    }
  };

  const filteredSnapshots = snapshots.filter(s => {
    const search = searchTerm.toLowerCase();
    return (
      s.dateFormatted.toLowerCase().includes(search) ||
      s.triggerReason.toLowerCase().includes(search) ||
      s.id.toLowerCase().includes(search)
    );
  });

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {statusNotification && (
        <div className="fixed top-5 right-5 z-50 bg-emerald-600 text-white px-4 py-2.5 rounded-xl shadow-2xl border border-emerald-400 flex items-center gap-2 animate-bounce font-medium text-xs">
          <IconShieldCheck className="w-4 h-4 text-white" />
          <span>{statusNotification}</span>
        </div>
      )}

      {/* Main Header & Auto Backup Status Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-700/80 rounded-2xl p-5 sm:p-6 shadow-xl relative overflow-hidden">
        <div className="space-y-5 relative z-10">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
            <div className="flex items-start sm:items-center gap-3">
              <div className="p-2.5 bg-indigo-600/20 rounded-xl border border-indigo-500/30 text-indigo-400 flex-shrink-0">
                <IconShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg sm:text-xl font-bold text-white">Central de Backup Automático & Restauração</h3>
                  {config.autoBackupEnabled ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-950/80 text-emerald-400 border border-emerald-500/30">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                      Sistema Protegido & Ativo
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-950/80 text-amber-400 border border-amber-500/30">
                      Pausado
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Proteção contínua e transparente contra erros, exclusões acidentais e perda de dados dos projetos.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 flex-shrink-0">
              <button
                onClick={handleCreateManualBackup}
                disabled={isCreatingBackup}
                className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition-all shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <IconPlus className="w-4 h-4" />
                {isCreatingBackup ? "Gerando..." : "Gerar Backup Agora"}
              </button>
              <button
                onClick={() => BackupService.exportBackupToExcel()}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-500/40 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 whitespace-nowrap shadow-sm hover:border-emerald-400"
                title="Exportar planilha Excel completa com todas as demandas para usar como backup"
              >
                <IconDownload className="w-4 h-4 text-emerald-400" />
                Exportar Excel (.xlsx)
              </button>
              <button
                onClick={handleSelectLocalFolder}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 whitespace-nowrap"
                title="Vincular pasta do computador para salvar backups automaticamente"
              >
                <IconFolder className="w-4 h-4 text-emerald-400" />
                Selecionar Pasta Destino
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
            <div className="flex items-center gap-1.5 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700/80">
              <IconClock className="w-4 h-4 text-indigo-400 flex-shrink-0" />
              <span>Último Backup: <strong className="text-white font-mono">{config.lastBackupTimestamp ? new Date(config.lastBackupTimestamp).toLocaleString('pt-BR') : 'Sem registro'}</strong></span>
            </div>
            <div className="flex items-center gap-1.5 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700/80 max-w-full overflow-hidden" title={selectedFolderHandleName || config.backupFolder}>
              <IconFolder className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span className="flex items-center gap-1 truncate">
                Pasta Destino: 
                <strong className="text-emerald-300 font-mono truncate max-w-[180px] sm:max-w-[280px] inline-block align-bottom">
                  {selectedFolderHandleName || config.backupFolder}
                </strong>
              </span>
            </div>
            <div className="flex items-center gap-1.5 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700/80">
              <IconShieldCheck className="w-4 h-4 text-sky-400 flex-shrink-0" />
              <span>Pontos de Restauração: <strong className="text-sky-300 font-mono">{snapshots.length} salvos</strong></span>
            </div>
          </div>
        </div>
      </div>

      {/* Backup Settings & Folder Destination Settings */}
      <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-5 space-y-4">
        <h4 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <IconShieldCheck className="w-4 h-4 text-indigo-400" /> Configurações de Automação do Backup
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          {/* Toggle Auto Backup on Change */}
          <div className="bg-slate-900/80 p-3.5 rounded-xl border border-slate-700/80 flex items-center justify-between gap-3">
            <div>
              <p className="font-bold text-slate-200">Backup em Alterações</p>
              <p className="text-[11px] text-slate-400">Salva ao modificar tarefas, sprints e robôs</p>
            </div>
            <input
              type="checkbox"
              checked={config.backupOnDataChange}
              onChange={e => handleSaveConfig({ backupOnDataChange: e.target.checked })}
              className="rounded bg-slate-800 border-slate-600 text-indigo-600 focus:ring-indigo-500 h-4 w-4 cursor-pointer"
            />
          </div>

          {/* Toggle Daily Auto Backup */}
          <div className="bg-slate-900/80 p-3.5 rounded-xl border border-slate-700/80 flex items-center justify-between gap-3">
            <div>
              <p className="font-bold text-slate-200">Backup Diário Automático</p>
              <p className="text-[11px] text-slate-400">Registra cópia diária garantida</p>
            </div>
            <input
              type="checkbox"
              checked={config.dailyBackupEnabled}
              onChange={e => handleSaveConfig({ dailyBackupEnabled: e.target.checked })}
              className="rounded bg-slate-800 border-slate-600 text-indigo-600 focus:ring-indigo-500 h-4 w-4 cursor-pointer"
            />
          </div>

          {/* Retention limit */}
          <div className="bg-slate-900/80 p-3.5 rounded-xl border border-slate-700/80 space-y-1">
            <p className="font-bold text-slate-200">Limite de Retenção</p>
            <select
              value={config.maxSnapshotsRetention}
              onChange={e => handleSaveConfig({ maxSnapshotsRetention: Number(e.target.value) })}
              className="w-full bg-slate-800 border border-slate-600 rounded p-1.5 text-xs text-white outline-none focus:border-indigo-500 mt-1"
            >
              <option value={10}>Manter últimos 10 backups</option>
              <option value={20}>Manter últimos 20 backups</option>
              <option value={30}>Manter últimos 30 backups</option>
              <option value={50}>Manter últimos 50 backups</option>
            </select>
          </div>

          {/* Destination Folder Path Name */}
          <div className="bg-slate-900/80 p-3.5 rounded-xl border border-slate-700/80 space-y-1">
            <p className="font-bold text-slate-200">Nome da Pasta Destino</p>
            <div className="flex gap-1.5 pt-1">
              <input
                type="text"
                value={folderPathInput}
                onChange={e => setFolderPathInput(e.target.value)}
                className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-white outline-none focus:border-indigo-500 font-mono"
                placeholder="Ex: Nexus_Backups"
              />
              <button
                onClick={handleUpdateFolderPathName}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-1 rounded text-xs font-bold"
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Restoration Points Section */}
      <div className="space-y-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h3 className="text-lg font-bold text-indigo-400 flex items-center gap-2">
              <IconRefresh className="w-5 h-5 text-indigo-400" /> Pontos de Restauração e Histórico
            </h3>
            <p className="text-xs text-slate-400">
              Selecione qualquer ponto da lista para visualizar os detalhes ou restaurar instantaneamente a aplicação para aquele momento.
            </p>
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto">
            {/* Search Filter */}
            <div className="relative flex-1 md:w-64">
              <IconSearch className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Buscar backups por data ou motivo..."
                className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white outline-none focus:border-indigo-500"
              />
            </div>

            {/* Excel Backup Import Button */}
            <label className="bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-all shadow-md shadow-emerald-600/25 flex items-center gap-1.5 flex-shrink-0">
              <IconUpload className="w-4 h-4 text-white" />
              <span>{isProcessingExcel ? "Lendo Excel..." : "Subir Planilha Excel (Backup)"}</span>
              <input 
                type="file" 
                accept=".xlsx, .xls" 
                onChange={handleImportExcelFile} 
                disabled={isProcessingExcel}
                className="hidden" 
              />
            </label>

            {/* External JSON Import Button */}
            <label className="bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-colors flex items-center gap-1.5 flex-shrink-0">
              <IconUpload className="w-4 h-4 text-slate-400" />
              <span>Importar JSON</span>
              <input type="file" accept=".json" onChange={handleImportFile} className="hidden" />
            </label>
          </div>
        </div>

        {/* Snapshots List */}
        {filteredSnapshots.length === 0 ? (
          <div className="bg-slate-800/40 border border-slate-700/60 rounded-2xl p-8 text-center space-y-3">
            <IconShieldCheck className="w-10 h-10 text-slate-600 mx-auto" />
            <p className="text-sm font-bold text-slate-300">Nenhum Ponto de Restauração Encontrado</p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              O sistema gera backups automaticamente em cada alteração de projeto. Clique em "Gerar Backup Agora" para criar o primeiro snapshot manual.
            </p>
            <button
              onClick={handleCreateManualBackup}
              className="mt-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-2"
            >
              <IconPlus className="w-4 h-4" /> Criar Primeiro Backup
            </button>
          </div>
        ) : (
          <div className="space-y-3 max-h-[500px] overflow-y-auto custom-scrollbar pr-1">
            {filteredSnapshots.map((snap, index) => {
              const isDaily = snap.triggerReason.includes('Diário');
              const isPreRestore = snap.triggerReason.includes('Pré-Restauração');
              const isManual = snap.triggerReason.includes('Manual');

              let badgeColor = 'bg-sky-950/80 text-sky-400 border-sky-500/30';
              if (isDaily) badgeColor = 'bg-emerald-950/80 text-emerald-400 border-emerald-500/30';
              if (isPreRestore) badgeColor = 'bg-purple-950/80 text-purple-400 border-purple-500/30';
              if (isManual) badgeColor = 'bg-indigo-950/80 text-indigo-400 border-indigo-500/30';

              return (
                <div
                  key={snap.id}
                  className="bg-slate-800/60 hover:bg-slate-800 border border-slate-700 hover:border-slate-600 transition-all rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-md"
                >
                  <div className="space-y-1.5 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-sm text-white font-mono">{snap.dateFormatted}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badgeColor}`}>
                        {snap.triggerReason}
                      </span>
                      {index === 0 && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500 text-slate-950">
                          Mais Recente
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 pt-1">
                      <span className="bg-slate-900/80 px-2 py-0.5 rounded border border-slate-700/60">
                        📦 <strong>{snap.stats.tasksCount}</strong> Demandas
                      </span>
                      <span className="bg-slate-900/80 px-2 py-0.5 rounded border border-slate-700/60">
                        🤖 <strong>{snap.stats.robotsCount}</strong> Robôs
                      </span>
                      <span className="bg-slate-900/80 px-2 py-0.5 rounded border border-slate-700/60">
                        🏃 <strong>{snap.stats.sprintsCount}</strong> Sprints
                      </span>
                      <span className="bg-slate-900/80 px-2 py-0.5 rounded border border-slate-700/60 text-slate-500 font-mono">
                        Tamanho: {snap.sizeKb} KB
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-700/60">
                    <button
                      onClick={() => setInspectSnapshot(snap)}
                      className="px-3 py-1.5 bg-slate-700/80 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors"
                      title="Ver conteúdo detalhado deste backup"
                    >
                      Inspecionar
                    </button>
                    <button
                      onClick={() => BackupService.exportSnapshotToFile(snap)}
                      className="px-3 py-1.5 bg-slate-700/80 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors flex items-center gap-1"
                      title="Baixar arquivo JSON para o computador"
                    >
                      <IconDownload className="w-3.5 h-3.5 text-indigo-400" />
                      Baixar
                    </button>
                    <button
                      onClick={() => setRestoreConfirmSnapshot(snap)}
                      className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition-all shadow-md shadow-emerald-600/20 flex items-center gap-1.5"
                    >
                      <IconRefresh className="w-3.5 h-3.5" />
                      Restaurar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* INSPECT SNAPSHOT MODAL */}
      {inspectSnapshot && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-slate-800 border border-slate-600 rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-slate-700 flex justify-between items-center bg-slate-900/80">
              <div className="flex items-center gap-2">
                <IconShieldCheck className="w-5 h-5 text-indigo-400" />
                <h4 className="text-base font-bold text-white">Detalhes do Ponto de Restauração</h4>
              </div>
              <button
                onClick={() => setInspectSnapshot(null)}
                className="text-slate-400 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto custom-scrollbar flex-1 text-xs">
              <div className="grid grid-cols-2 gap-3 bg-slate-900/80 p-3.5 rounded-xl border border-slate-700/80">
                <div>
                  <span className="text-slate-500 block">Data/Hora:</span>
                  <span className="text-white font-bold font-mono">{inspectSnapshot.dateFormatted}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Motivo do Backup:</span>
                  <span className="text-indigo-400 font-bold">{inspectSnapshot.triggerReason}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">ID do Snapshot:</span>
                  <span className="text-slate-300 font-mono">{inspectSnapshot.id}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Hash de Integridade:</span>
                  <span className="text-emerald-400 font-mono">{inspectSnapshot.dataHash}</span>
                </div>
              </div>

              <div>
                <h5 className="font-bold text-slate-200 mb-2 uppercase text-[11px] tracking-wider">
                  Resumo do Conteúdo Armazenado
                </h5>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="bg-slate-900 p-3 rounded-lg border border-slate-700 text-center">
                    <span className="text-2xl font-bold text-indigo-400 block">{inspectSnapshot.stats.tasksCount}</span>
                    <span className="text-slate-400 text-[11px]">Demandas / Projetos</span>
                  </div>
                  <div className="bg-slate-900 p-3 rounded-lg border border-slate-700 text-center">
                    <span className="text-2xl font-bold text-emerald-400 block">{inspectSnapshot.stats.robotsCount}</span>
                    <span className="text-slate-400 text-[11px]">Robôs RPA</span>
                  </div>
                  <div className="bg-slate-900 p-3 rounded-lg border border-slate-700 text-center">
                    <span className="text-2xl font-bold text-sky-400 block">{inspectSnapshot.stats.sprintsCount}</span>
                    <span className="text-slate-400 text-[11px]">Sprints</span>
                  </div>
                  <div className="bg-slate-900 p-3 rounded-lg border border-slate-700 text-center">
                    <span className="text-2xl font-bold text-amber-400 block">{inspectSnapshot.stats.devsCount}</span>
                    <span className="text-slate-400 text-[11px]">Desenvolvedores</span>
                  </div>
                  <div className="bg-slate-900 p-3 rounded-lg border border-slate-700 text-center">
                    <span className="text-2xl font-bold text-purple-400 block">{inspectSnapshot.stats.workflowPhasesCount}</span>
                    <span className="text-slate-400 text-[11px]">Fases de Workflow</span>
                  </div>
                  <div className="bg-slate-900 p-3 rounded-lg border border-slate-700 text-center">
                    <span className="text-2xl font-bold text-rose-400 block">{inspectSnapshot.stats.documentsCount}</span>
                    <span className="text-slate-400 text-[11px]">Documentos</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-700 bg-slate-900 flex justify-end gap-3">
              <button
                onClick={() => setInspectSnapshot(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold"
              >
                Fechar
              </button>
              <button
                onClick={() => {
                  const snap = inspectSnapshot;
                  setInspectSnapshot(null);
                  setRestoreConfirmSnapshot(snap);
                }}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold"
              >
                Restaurar Este Ponto
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM RESTORE MODAL */}
      {restoreConfirmSnapshot && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-slate-800 border border-emerald-500/40 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-emerald-950 rounded-xl border border-emerald-500/30 text-emerald-400">
                <IconRefresh className="w-7 h-7 animate-spin" style={{ animationDuration: '6s' }} />
              </div>
              <div>
                <h4 className="text-lg font-bold text-white">Confirmar Restauração do App</h4>
                <p className="text-xs text-slate-400">Restaurando o estado da ferramenta para o ponto selecionado.</p>
              </div>
            </div>

            <div className="bg-slate-900/90 border border-slate-700/80 p-4 rounded-xl space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Ponto Selecionado:</span>
                <span className="text-white font-bold font-mono">{restoreConfirmSnapshot.dateFormatted}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Origem/Motivo:</span>
                <span className="text-indigo-400 font-bold">{restoreConfirmSnapshot.triggerReason}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Total de Conteúdos:</span>
                <span className="text-emerald-400 font-bold">
                  {restoreConfirmSnapshot.stats.tasksCount} tarefas | {restoreConfirmSnapshot.stats.robotsCount} robôs | {restoreConfirmSnapshot.stats.sprintsCount} sprints
                </span>
              </div>
            </div>

            <div className="bg-indigo-950/40 border border-indigo-500/30 p-3 rounded-xl text-[11px] text-indigo-300 space-y-1">
              <p className="font-bold flex items-center gap-1.5 text-indigo-200">
                <IconShieldCheck className="w-4 h-4 text-emerald-400" /> Cópia de Segurança Pré-Restauração
              </p>
              <p>
                Antes de aplicar esta restauração, o sistema gerará automaticamente uma cópia de segurança do seu estado atual, garantindo total conversão e reversibilidade.
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setRestoreConfirmSnapshot(null)}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-bold rounded-xl"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  const snap = restoreConfirmSnapshot;
                  setRestoreConfirmSnapshot(null);
                  handleExecuteRestore(snap);
                }}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-emerald-600/30 flex items-center gap-2"
              >
                <IconCheck className="w-4 h-4" /> Restaurar Agora
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EXCEL BACKUP RECOGNIZED CONFIRMATION MODAL */}
      {excelImportResult && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-slate-800 border-2 border-emerald-500/60 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5">
            {/* Header */}
            <div className="flex items-start gap-3 border-b border-slate-700/80 pb-4">
              <div className="p-3 bg-emerald-950 rounded-2xl border border-emerald-500/40 text-emerald-400 flex-shrink-0">
                <IconShieldCheck className="w-7 h-7 text-emerald-400" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h4 className="text-lg font-bold text-white">Planilha Excel Reconhecida como Backup</h4>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-500/30">
                    Reconhecido
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1 font-mono truncate max-w-md">
                  Arquivo: <strong className="text-slate-200">{excelImportResult.fileName}</strong>
                </p>
              </div>
            </div>

            {/* Stats Breakdown */}
            <div className="bg-slate-900/90 border border-slate-700 rounded-xl p-4 space-y-3">
              <p className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                📊 Dados identificados na planilha:
              </p>
              <div className="grid grid-cols-3 gap-2.5">
                <div className="bg-slate-800/80 p-2.5 rounded-lg border border-slate-700 text-center">
                  <span className="text-xl font-bold text-white block">{excelImportResult.stats.tasksCount}</span>
                  <span className="text-[11px] text-slate-400">Total Demandas</span>
                </div>
                <div className="bg-slate-800/80 p-2.5 rounded-lg border border-rose-500/20 text-center">
                  <span className="text-xl font-bold text-rose-400 block">{excelImportResult.stats.incidentsCount}</span>
                  <span className="text-[11px] text-slate-400">Incidentes</span>
                </div>
                <div className="bg-slate-800/80 p-2.5 rounded-lg border border-amber-500/20 text-center">
                  <span className="text-xl font-bold text-amber-400 block">{excelImportResult.stats.improvementsCount}</span>
                  <span className="text-[11px] text-slate-400">Melhorias</span>
                </div>
                <div className="bg-slate-800/80 p-2.5 rounded-lg border border-sky-500/20 text-center">
                  <span className="text-xl font-bold text-sky-400 block">{excelImportResult.stats.automationsCount}</span>
                  <span className="text-[11px] text-slate-400">Novas Automações</span>
                </div>
                <div className="bg-slate-800/80 p-2.5 rounded-lg border border-indigo-500/20 text-center">
                  <span className="text-xl font-bold text-indigo-400 block">{excelImportResult.stats.devsCount}</span>
                  <span className="text-[11px] text-slate-400">Desenvolvedores</span>
                </div>
                <div className="bg-slate-800/80 p-2.5 rounded-lg border border-emerald-500/20 text-center">
                  <span className="text-xl font-bold text-emerald-400 block">{excelImportResult.stats.robotsCount}</span>
                  <span className="text-[11px] text-slate-400">Robôs RPA</span>
                </div>
              </div>
            </div>

            {/* Restore Mode Selection */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-300 block">
                Selecione o modo de restauração no Banco de Dados:
              </label>
              <div className="space-y-2">
                <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${excelRestoreMode === 'replace' ? 'bg-indigo-950/40 border-indigo-500/80 text-white' : 'bg-slate-900/60 border-slate-700 text-slate-300 hover:bg-slate-900'}`}>
                  <input
                    type="radio"
                    name="excelRestoreMode"
                    value="replace"
                    checked={excelRestoreMode === 'replace'}
                    onChange={() => setExcelRestoreMode('replace')}
                    className="mt-1 accent-indigo-500"
                  />
                  <div className="text-xs">
                    <p className="font-bold text-white">Substituição Completa (Restauração Limpa)</p>
                    <p className="text-slate-400 mt-0.5">
                      Substitui todas as demandas do banco de dados pelo conteúdo desta planilha. Um backup de segurança do estado atual é criado automaticamente antes.
                    </p>
                  </div>
                </label>

                <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${excelRestoreMode === 'merge' ? 'bg-indigo-950/40 border-indigo-500/80 text-white' : 'bg-slate-900/60 border-slate-700 text-slate-300 hover:bg-slate-900'}`}>
                  <input
                    type="radio"
                    name="excelRestoreMode"
                    value="merge"
                    checked={excelRestoreMode === 'merge'}
                    onChange={() => setExcelRestoreMode('merge')}
                    className="mt-1 accent-indigo-500"
                  />
                  <div className="text-xs">
                    <p className="font-bold text-white">Mesclagem Inteligente (Merge / Adicionar)</p>
                    <p className="text-slate-400 mt-0.5">
                      Atualiza demandas existentes que tiverem o mesmo ID/número e cadastra as novas demandas sem remover os registros já salvos.
                    </p>
                  </div>
                </label>
              </div>
            </div>

            {/* Warning Info */}
            <div className="bg-emerald-950/40 border border-emerald-500/30 p-3 rounded-xl text-[11px] text-emerald-300 flex items-center gap-2">
              <IconShieldCheck className="w-5 h-5 text-emerald-400 flex-shrink-0" />
              <span>
                Ao confirmar, todas as demandas serão gravadas diretamente no seu banco de dados na nuvem (Firestore) e estarão disponíveis instantaneamente em todos os módulos.
              </span>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap justify-end gap-3 pt-2 border-t border-slate-700">
              <button
                onClick={() => setExcelImportResult(null)}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-bold rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  setExcelImportResult(null);
                  showNotification("✔ Backup adicionado ao histórico de restauração.");
                }}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-slate-600 text-xs font-bold rounded-xl transition-colors"
                title="Apenas adiciona ao histórico para restauração posterior"
              >
                Salvar Apenas no Histórico
              </button>
              <button
                onClick={handleExecuteExcelRestore}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-emerald-600/30 flex items-center gap-2 transition-all hover:scale-[1.02]"
              >
                <IconCheck className="w-4 h-4" />
                Sim, Restaurar Banco de Dados Agora
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
