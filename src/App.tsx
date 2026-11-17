import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Engine } from './game/engine';
import type { EnginePhase } from './game/engine';
import { generateLevelFromSeed } from './generation/levelGenerator';
import { SaveStore } from './game/persistence';
import type { Settings } from './game/persistence';
import type { LevelIdentity, LevelIntro, MissionDebrief, MissionKind, RunSummary, SfxName, UpgradeId, UpgradeOffer } from './game/types';
import { getAstroService } from './astronomy/systems/live';
import { getSystems } from './astronomy/systems/store';
import type { StarSystem } from './astronomy/systems/types';
import { Catalogue } from './ui/Catalogue';
import { DiscoveryToast } from './ui/DiscoveryToast';
import { GameOver } from './ui/GameOver';
import { Hangar } from './ui/Hangar';
import { HowToPlay } from './ui/HowToPlay';
import { Hud } from './ui/Hud';
import { useTouchMode } from './ui/hooks';
import { LevelIntroCard } from './ui/LevelIntro';
import { MainMenu } from './ui/MainMenu';
import { MissionDebriefCard } from './ui/MissionDebrief';
import { Missions } from './ui/Missions';
import { Profile } from './ui/Profile';
import { RewardToasts, toastsFor } from './ui/RewardToasts';
import type { Toast } from './ui/RewardToasts';
import { RunModifiers } from './ui/RunModifiers';
import { PauseMenu } from './ui/PauseMenu';
import { SettingsPanel } from './ui/SettingsPanel';
import { ShipUpgrades } from './ui/ShipUpgrades';
import { CASE_REVEAL_MS, Shop } from './ui/Shop';
import { TouchControls } from './ui/TouchControls';
import { UpgradePicker } from './ui/UpgradePicker';

type MenuScreen = 'main' | 'upgrades' | 'catalogue' | 'howto' | 'settings' | 'missions' | 'modifiers' | 'hangar' | 'shop' | 'profile';
type PauseView = 'main' | 'settings' | 'howto';
/** What "retry" should start again: an ordinary run, a mission practice, or a flight to a chosen system. */
type Replay = { kind: 'run' } | { kind: 'mission'; mission: MissionKind } | { kind: 'system'; system: StarSystem };

export function App() {
  const stageRef = useRef<HTMLDivElement>(null);
  const store = useMemo(() => new SaveStore(), []);
  const save = useSyncExternalStore(store.subscribe, store.get);
  // Cached live imports are loaded into the system catalogue up front (no network), so that runs
  // can draw on them from the first sector.
  const systems = useMemo(() => {
    const cat = getSystems();
    getAstroService(cat);
    return cat;
  }, []);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [phase, setPhase] = useState<EnginePhase>('menu');
  const [screen, setScreen] = useState<MenuScreen>('main');
  const [pauseView, setPauseView] = useState<PauseView>('main');
  const [offer, setOffer] = useState<UpgradeOffer[] | null>(null);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [intro, setIntro] = useState<LevelIntro | null>(null);
  const [debrief, setDebrief] = useState<MissionDebrief | null>(null);
  const [replay, setReplay] = useState<Replay>({ kind: 'run' });
  const [discovery, setDiscovery] = useState<{ identity: LevelIdentity; key: number } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
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
            setDebrief(null);
          }
          break;
        case 'offer':
          setOffer(e.options);
          break;
        case 'debrief':
          setDebrief(e.debrief);
          break;
        case 'intro':
          setDebrief(null);
          setIntro(e.intro);
          setDiscovery(e.intro.discovery ? { identity: e.intro.identity, key: e.intro.key } : null);
          break;
        case 'gameover':
          setSummary(e.summary);
          break;
        case 'reward':
          break; // shown through the progression listener below, which also covers menu purchases
      }
    });
    // Anything lasting that any event earns - in a run or in a menu - becomes a toast.
    const offRewards = eng.progress.onOutcome((out, event) => {
      const fresh = toastsFor(out);
      if (fresh.length === 0) return;
      const show = (): void => setToasts((t) => [...t, ...fresh].slice(-8));
      // A case's own reveal comes first; what it unlocked is announced once the reel has stopped.
      if (event.type === 'open_case') window.setTimeout(show, CASE_REVEAL_MS + 400);
      else show();
    });
    // A save carried over from an earlier version may already have earned things that did not exist then.
    eng.settle();
    // Browsers only allow audio after a user gesture.
    const unlock = () => eng.audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      off();
      offRewards();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      eng.destroy();
      setEngine(null);
    };
  }, [store]);

  useEffect(() => {
    engine?.applySettings(save.settings);
  }, [engine, save.settings]);

  // Whatever is fitted in the hangar is what flies - including on the menu's own ship.
  useEffect(() => {
    engine?.applyLook(save.inventory.equipped);
  }, [engine, save.inventory.equipped]);

  const sfx = useCallback((n: SfxName) => engine?.sfx(n), [engine]);

  const begin = useCallback((next: Replay) => {
    setScreen('main');
    setSummary(null);
    setReplay(next);
    setRunId((r) => r + 1);
  }, []);

  const play = useCallback(() => {
    if (!engine) return;
    begin({ kind: 'run' });
    engine.startRun();
  }, [engine, begin]);

  const practise = useCallback(
    (kind: MissionKind) => {
      if (!engine) return;
      begin({ kind: 'mission', mission: kind });
      engine.playMission(kind);
    },
    [engine, begin],
  );

  const fly = useCallback(
    (system: StarSystem) => {
      if (!engine) return;
      begin({ kind: 'system', system });
      if (!engine.playSystem(system)) setScreen('catalogue');
    },
    [engine, begin],
  );

  const retry = useCallback(() => (replay.kind === 'mission' ? practise(replay.mission) : replay.kind === 'system' ? fly(replay.system) : play()), [replay, practise, fly, play]);

  const toMenu = useCallback(() => {
    if (!engine) return;
    setScreen('main');
    engine.toMenu();
  }, [engine]);

  const updateSettings = useCallback((patch: Partial<Settings>) => store.updateSettings(patch), [store]);
  const home = useCallback(() => setScreen('main'), []);

  const inRun = phase === 'playing' || phase === 'paused' || phase === 'upgrade';
  const showHint = save.records.totalRuns < 3;
  const menu = engine && phase === 'menu';

  return (
    <div className="app">
      <div className="stage" ref={stageRef} />
      {!save.settings.reducedEffects && <div className="scanlines" />}

      {menu && screen === 'main' && (
        <MainMenu
          save={save}
          onPlay={play}
          onUpgrades={() => setScreen('upgrades')}
          onMissions={() => setScreen('missions')}
          onModifiers={() => setScreen('modifiers')}
          onCatalogue={() => setScreen('catalogue')}
          onHangar={() => setScreen('hangar')}
          onShop={() => setScreen('shop')}
          onProfile={() => setScreen('profile')}
          systemCount={systems.size}
          onHowTo={() => setScreen('howto')}
          onSettings={() => setScreen('settings')}
          sfx={sfx}
        />
      )}
      {menu && screen === 'upgrades' && <ShipUpgrades save={save} progress={engine.progress} onBack={home} sfx={sfx} />}
      {menu && screen === 'hangar' && <Hangar save={save} progress={engine.progress} onBack={home} onShop={() => setScreen('shop')} sfx={sfx} />}
      {menu && screen === 'shop' && <Shop save={save} progress={engine.progress} onBack={home} onHangar={() => setScreen('hangar')} sfx={sfx} />}
      {menu && screen === 'profile' && <Profile save={save} progress={engine.progress} onBack={home} sfx={sfx} />}
      {menu && screen === 'catalogue' && <Catalogue save={save} progress={engine.progress} onFly={fly} onBack={home} sfx={sfx} />}
      {menu && screen === 'missions' && <Missions save={save} onPractice={practise} onBack={home} sfx={sfx} />}
      {menu && screen === 'modifiers' && <RunModifiers save={save} store={store} onBack={home} sfx={sfx} />}
      {menu && screen === 'howto' && <HowToPlay onBack={home} sfx={sfx} />}
      {menu && screen === 'settings' && <SettingsPanel settings={save.settings} onChange={updateSettings} onBack={home} onReset={() => store.reset()} sfx={sfx} />}

      {engine && inRun && <Hud key={runId} engine={engine} touch={touch} showHint={showHint} onPause={() => engine.pause()} />}
      {engine && inRun && intro && <LevelIntroCard intro={intro} onDone={() => setIntro(null)} />}
      {engine && inRun && !intro && debrief && <MissionDebriefCard debrief={debrief} onDone={() => setDebrief(null)} />}
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
          onRestart={retry}
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

      {engine && phase === 'gameover' && summary && <GameOver summary={summary} practice={replay.kind !== 'run'} onRetry={retry} onMenu={toMenu} sfx={sfx} />}

      <RewardToasts toasts={toasts} onDone={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  );
}
