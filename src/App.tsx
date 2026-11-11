import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Engine } from './game/engine';
import type { EnginePhase } from './game/engine';
import { generateLevelFromSeed } from './generation/levelGenerator';
import { SaveStore } from './game/persistence';
import type { Settings } from './game/persistence';
import type { LevelIdentity, LevelIntro, RunSummary, SfxName, UpgradeId, UpgradeOffer } from './game/types';
import { getCatalogue } from './astronomy/database/catalogue';
import { Catalogue } from './ui/Catalogue';
import { DiscoveryToast } from './ui/DiscoveryToast';
import { GameOver } from './ui/GameOver';
import { HowToPlay } from './ui/HowToPlay';
import { Hud } from './ui/Hud';
import { useTouchMode } from './ui/hooks';
import { LevelIntroCard } from './ui/LevelIntro';
import { MainMenu } from './ui/MainMenu';
import { PauseMenu } from './ui/PauseMenu';
import { SettingsPanel } from './ui/SettingsPanel';
import { ShipUpgrades } from './ui/ShipUpgrades';
import { TouchControls } from './ui/TouchControls';
import { UpgradePicker } from './ui/UpgradePicker';

type MenuScreen = 'main' | 'upgrades' | 'catalogue' | 'howto' | 'settings';
type PauseView = 'main' | 'settings' | 'howto';

export function App() {
  const stageRef = useRef<HTMLDivElement>(null);
  const store = useMemo(() => new SaveStore(), []);
  const save = useSyncExternalStore(store.subscribe, store.get);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [phase, setPhase] = useState<EnginePhase>('menu');
  const [screen, setScreen] = useState<MenuScreen>('main');
  const [pauseView, setPauseView] = useState<PauseView>('main');
  const [offer, setOffer] = useState<UpgradeOffer[] | null>(null);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [intro, setIntro] = useState<LevelIntro | null>(null);
  const [discovery, setDiscovery] = useState<{ identity: LevelIdentity; key: number } | null>(null);
  const [runId, setRunId] = useState(0);
  const touch = useTouchMode(save.settings.touchControls);

  // Engine lifecycle: one engine (and one canvas) for the whole app.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const eng = new Engine(el, store);
    setEngine(eng);
    // Debug handle for development only (stripped from production builds).
    if (import.meta.env.DEV) {
      const w = window as unknown as { __engine?: Engine; __findLevel?: (env: string, index?: number) => unknown };
      w.__engine = eng;
      // Dev console helper: __findLevel('quasar', 20) jumps straight into the first seeded level of that environment.
      w.__findLevel = (env, index = 20) => {
        for (let seed = 1; seed < 5000; seed++) {
          const level = generateLevelFromSeed(seed, index);
          if (level.identity.environment === env) {
            eng.playLevel(level);
            return level;
          }
        }
        return null;
      };
    }
    const off = eng.on((e) => {
      switch (e.type) {
        case 'phase':
          setPhase(e.phase);
          if (e.phase !== 'upgrade') setOffer(null);
          if (e.phase === 'playing' || e.phase === 'menu') setSummary(null);
          if (e.phase === 'paused') setPauseView('main');
          if (e.phase === 'menu' || e.phase === 'gameover') {
            setIntro(null);
            setDiscovery(null);
          }
          break;
        case 'offer':
          setOffer(e.options);
          break;
        case 'intro':
          setIntro(e.intro);
          setDiscovery(e.intro.discovery ? { identity: e.intro.identity, key: e.intro.key } : null);
          break;
        case 'gameover':
          setSummary(e.summary);
          break;
      }
    });
    // Browsers only allow audio after a user gesture.
    const unlock = () => eng.audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      off();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      eng.destroy();
      setEngine(null);
    };
  }, [store]);

  useEffect(() => {
    engine?.applySettings(save.settings);
  }, [engine, save.settings]);

  const sfx = useCallback((n: SfxName) => engine?.sfx(n), [engine]);

  const play = useCallback(() => {
    if (!engine) return;
    setScreen('main');
    setSummary(null);
    setRunId((r) => r + 1);
    engine.startRun();
  }, [engine]);

  const toMenu = useCallback(() => {
    if (!engine) return;
    setScreen('main');
    engine.toMenu();
  }, [engine]);

  const updateSettings = useCallback((patch: Partial<Settings>) => store.updateSettings(patch), [store]);

  const inRun = phase === 'playing' || phase === 'paused' || phase === 'upgrade';
  const showHint = save.records.totalRuns < 3;

  return (
    <div className="app">
      <div className="stage" ref={stageRef} />
      {!save.settings.reducedEffects && <div className="scanlines" />}

      {engine && phase === 'menu' && screen === 'main' && (
        <MainMenu
          save={save}
          onPlay={play}
          onUpgrades={() => setScreen('upgrades')}
          onCatalogue={() => setScreen('catalogue')}
          catalogueSize={getCatalogue().size}
          onHowTo={() => setScreen('howto')}
          onSettings={() => setScreen('settings')}
          sfx={sfx}
        />
      )}
      {engine && phase === 'menu' && screen === 'upgrades' && (
        <ShipUpgrades save={save} store={store} onBack={() => setScreen('main')} sfx={sfx} />
      )}
      {engine && phase === 'menu' && screen === 'catalogue' && <Catalogue save={save} onBack={() => setScreen('main')} sfx={sfx} />}
      {engine && phase === 'menu' && screen === 'howto' && <HowToPlay onBack={() => setScreen('main')} sfx={sfx} />}
      {engine && phase === 'menu' && screen === 'settings' && (
        <SettingsPanel
          settings={save.settings}
          onChange={updateSettings}
          onBack={() => setScreen('main')}
          onReset={() => store.reset()}
          sfx={sfx}
        />
      )}

      {engine && inRun && <Hud key={runId} engine={engine} touch={touch} showHint={showHint} onPause={() => engine.pause()} />}
      {engine && inRun && intro && <LevelIntroCard intro={intro} onDone={() => setIntro(null)} />}
      {engine && phase === 'playing' && !intro && discovery && (
        <DiscoveryToast identity={discovery.identity} toastKey={discovery.key} onDone={() => setDiscovery(null)} />
      )}
      {engine && phase === 'playing' && touch && <TouchControls engine={engine} />}

      {engine && phase === 'upgrade' && offer && (
        <UpgradePicker key={offer.map((o) => o.id).join()} options={offer} onChoose={(id: UpgradeId) => engine.chooseUpgrade(id)} sfx={sfx} />
      )}

      {engine && phase === 'paused' && pauseView === 'main' && (
        <PauseMenu
          level={engine.hud.level}
          levelName={engine.hud.levelName}
          scan={engine.currentLevel}
          muted={save.settings.muted}
          onResume={() => engine.resume()}
          onRestart={play}
          onSettings={() => setPauseView('settings')}
          onHowTo={() => setPauseView('howto')}
          onMenu={toMenu}
          onToggleMute={() => updateSettings({ muted: !save.settings.muted })}
          sfx={sfx}
        />
      )}
      {engine && phase === 'paused' && pauseView === 'settings' && (
        <SettingsPanel settings={save.settings} onChange={updateSettings} onBack={() => setPauseView('main')} sfx={sfx} />
      )}
      {engine && phase === 'paused' && pauseView === 'howto' && <HowToPlay onBack={() => setPauseView('main')} sfx={sfx} />}

      {engine && phase === 'gameover' && summary && <GameOver summary={summary} onRetry={play} onMenu={toMenu} sfx={sfx} />}
    </div>
  );
}
