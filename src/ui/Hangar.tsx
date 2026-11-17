import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { COSMETICS, RARITIES, RARITY_COLOR, RARITY_LABEL, RARITY_RANK, SLOTS, SLOT_LABEL, acquisitionText, cosmetic, resolveLook } from '../game/cosmetics/catalog';
import type { CosmeticDef, CosmeticSlot, Loadout, Rarity } from '../game/cosmetics/catalog';
import type { SaveData } from '../game/persistence';
import type { SfxName } from '../game/types';
import { achievement } from '../progression/achievements';
import type { Progression } from '../progression/service';
import { useKeys } from './hooks';
import { CosmeticThumb, ShipPreview } from './ShipPreview';

interface Props {
  save: SaveData;
  progress: Progression;
  onBack: () => void;
  onShop: () => void;
  sfx: (n: SfxName) => void;
}

type Owned = 'all' | 'owned' | 'locked';

/** Where an owned item came from, in words. */
function sourceText(source: string): string {
  if (source === 'starter') return 'Standard issue';
  if (source === 'shop') return 'Bought in the shop';
  if (source.startsWith('case:')) return `Found in a ${source.slice(5).toUpperCase()} case`;
  if (source.startsWith('achievement:')) return `Awarded for ${achievement(source.slice(12))?.title ?? 'an achievement'}`;
  if (source.startsWith('level:')) return `Awarded at pilot level ${source.slice(6)}`;
  return 'Acquired';
}

/** How to get an item the pilot does not have yet. */
function howToGet(c: CosmeticDef): string {
  switch (c.obtain.kind) {
    case 'achievement':
      return `Unlock the achievement ${achievement(c.obtain.id)?.title ?? ''}`.trim();
    case 'level':
      return `Reach pilot level ${c.obtain.level}`;
    case 'shop':
      return `On sale in the shop for ${c.obtain.price} CR`;
    case 'case':
      return 'Found in cases from the shop';
    default:
      return 'Standard issue';
  }
}

/**
 * The hangar: the ship as it will fly, every cosmetic slot, and the whole collection - owned or
 * not - with search and filters. Selecting an item tries it on in the live preview before it is
 * fitted.
 */
export function Hangar({ save, progress, onBack, onShop, sfx }: Props) {
  const inv = save.inventory;
  const [slot, setSlot] = useState<CosmeticSlot>('hull');
  const [rarity, setRarity] = useState<Rarity | null>(null);
  const [owned, setOwned] = useState<Owned>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>(inv.equipped.hull);
  const [compare, setCompare] = useState(false);
  useKeys({ Escape: onBack });

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return COSMETICS.filter((c) => {
      // A search looks across every slot; otherwise the list follows the selected slot.
      if (!q && c.slot !== slot) return false;
      if (rarity && c.rarity !== rarity) return false;
      const has = !!inv.owned[c.id];
      if (owned === 'owned' && !has) return false;
      if (owned === 'locked' && has) return false;
      return !q || c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q) || RARITY_LABEL[c.rarity].toLowerCase() === q;
    }).sort((a, b) => RARITY_RANK[b.rarity] - RARITY_RANK[a.rarity] || a.name.localeCompare(b.name));
  }, [slot, rarity, owned, query, inv.owned]);

  const selected = cosmetic(selectedId) ?? cosmetic(inv.equipped[slot]);
  const tryOn: Loadout = selected ? { ...inv.equipped, [selected.slot]: selected.id } : inv.equipped;
  const lookTry = useMemo(() => resolveLook(tryOn), [JSON.stringify(tryOn)]); // eslint-disable-line react-hooks/exhaustive-deps
  const lookNow = useMemo(() => resolveLook(inv.equipped), [inv.equipped]);
  const isOwned = selected ? !!inv.owned[selected.id] : false;
  const isFitted = selected ? inv.equipped[selected.slot] === selected.id : false;
  const fresh = Object.entries(inv.owned).filter(([, o]) => o.fresh).map(([id]) => id);
  const ownedCount = Object.keys(inv.owned).length;

  const select = (c: CosmeticDef): void => {
    sfx('click');
    setSelectedId(c.id);
    if (inv.owned[c.id]?.fresh) progress.dispatch({ type: 'mark_seen', ids: [c.id] });
  };

  const equip = (): void => {
    if (!selected || !isOwned || isFitted) return;
    const out = progress.dispatch({ type: 'equip_cosmetic', slot: selected.slot, id: selected.id });
    sfx(out.ok ? 'upgrade' : 'warning');
  };

  const back = (): void => {
    sfx('click');
    if (fresh.length > 0) progress.dispatch({ type: 'mark_seen', ids: fresh });
    onBack();
  };

  return (
    <div className="overlay dim">
      <div className="panel hangar2" role="dialog" aria-label="Ship hangar">
        <div className="x-head">
          <div>
            <h2 className="panel-title">HANGAR</h2>
            <p className="panel-sub">
              {ownedCount}/{COSMETICS.length} ITEMS COLLECTED · COSMETIC ONLY: NOTHING HERE CHANGES HOW THE SHIP FLIES
            </p>
          </div>
          <div className="credits">
            <div className="label">CREDITS</div>
            <div className="value">{save.credits} CR</div>
          </div>
        </div>

        <div className="hangar-body">
          <div className="hangar-left">
            <div className={`bay rarity-${lookTry.rarity}`} style={{ '--rar': RARITY_COLOR[lookTry.rarity] } as CSSProperties}>
              <div className="bay-stage">
                <ShipPreview look={lookTry} width={104} height={64} scale={4.4} reduced={save.settings.reducedEffects} label="Ship with the selected item fitted" />
                {compare && !isFitted && (
                  <div className="bay-compare">
                    <ShipPreview look={lookNow} width={90} height={60} scale={2} reduced={save.settings.reducedEffects} label="Ship as currently fitted" />
                    <span className="label">FITTED NOW</span>
                  </div>
                )}
              </div>
              <div className="bay-foot">
                <span className="label">{isFitted || !selected ? 'CURRENT LOADOUT' : isOwned ? 'TRYING ON' : 'PREVIEW · NOT OWNED'}</span>
                <button className="btn small outline nav" onClick={() => setCompare((c) => !c)} aria-pressed={compare}>
                  {compare ? 'HIDE COMPARISON' : 'COMPARE WITH FITTED'}
                </button>
              </div>
            </div>

            <div className="slots">
              {SLOTS.map((s) => {
                const c = cosmetic(inv.equipped[s]);
                const news = COSMETICS.filter((x) => x.slot === s && inv.owned[x.id]?.fresh).length;
                return (
                  <button
                    key={s}
                    className={`slot nav${slot === s ? ' on' : ''}`}
                    style={{ '--rar': RARITY_COLOR[c?.rarity ?? 'common'] } as CSSProperties}
                    onClick={() => {
                      sfx('click');
                      setSlot(s);
                      setQuery('');
                      setSelectedId(inv.equipped[s]);
                    }}
                  >
                    <span className="label">{SLOT_LABEL[s]}</span>
                    <span className="slot-name">{c?.name ?? '—'}</span>
                    {news > 0 && <span className="new-dot">{news} NEW</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="hangar-right">
            <div className="filters">
              <input className="x-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="SEARCH THE COLLECTION" aria-label="Search cosmetics" spellCheck={false} />
              <div className="chips">
                <button className={`chip${rarity === null ? ' on' : ''}`} onClick={() => setRarity(null)}>
                  ALL
                </button>
                {RARITIES.map((r) => (
                  <button key={r} className={`chip rar${rarity === r ? ' on' : ''}`} style={{ '--rar': RARITY_COLOR[r] } as CSSProperties} onClick={() => setRarity(rarity === r ? null : r)}>
                    {RARITY_LABEL[r]}
                  </button>
                ))}
              </div>
              <div className="chips">
                {(['all', 'owned', 'locked'] as Owned[]).map((o) => (
                  <button key={o} className={`chip${owned === o ? ' on' : ''}`} onClick={() => setOwned(o)}>
                    {o === 'all' ? 'EVERYTHING' : o === 'owned' ? 'OWNED' : 'NOT YET OWNED'}
                  </button>
                ))}
              </div>
            </div>

            <div className="cos-grid" role="listbox" aria-label={query ? 'Search results' : SLOT_LABEL[slot]}>
              {items.map((c) => {
                const has = !!inv.owned[c.id];
                const fitted = inv.equipped[c.slot] === c.id;
                return (
                  <button
                    key={c.id}
                    role="option"
                    aria-selected={selected?.id === c.id}
                    className={`cos rarity-${c.rarity}${selected?.id === c.id ? ' on' : ''}${has ? '' : ' locked'}`}
                    style={{ '--rar': RARITY_COLOR[c.rarity] } as CSSProperties}
                    onClick={() => select(c)}
                  >
                    <CosmeticThumb item={c} locked={!has} />
                    <span className="cos-name">{c.name}</span>
                    <span className="cos-rar">{RARITY_LABEL[c.rarity]}</span>
                    {fitted && <span className="cos-tag fitted">FITTED</span>}
                    {has && inv.owned[c.id].fresh && <span className="cos-tag new">NEW</span>}
                  </button>
                );
              })}
              {items.length === 0 && <div className="cat-empty">NOTHING MATCHES THOSE FILTERS</div>}
            </div>

            {selected && (
              <div className={`cos-detail rarity-${selected.rarity}`} style={{ '--rar': RARITY_COLOR[selected.rarity] } as CSSProperties}>
                <div className="cos-detail-main">
                  <div className="cos-detail-top">
                    <span className="rar-badge">{RARITY_LABEL[selected.rarity]}</span>
                    <span className="label">{SLOT_LABEL[selected.slot]}</span>
                  </div>
                  <div className="cos-detail-name">{selected.name}</div>
                  <p className="cos-detail-desc">{selected.description}</p>
                  <div className="cos-detail-meta">
                    {isOwned ? (
                      <>
                        <span className="label">ACQUIRED</span> {sourceText(inv.owned[selected.id].source)}
                        {inv.owned[selected.id].at ? ` · ${inv.owned[selected.id].at.slice(0, 10)}` : ''}
                      </>
                    ) : (
                      <>
                        <span className="label">HOW TO GET IT</span> {howToGet(selected)}
                      </>
                    )}
                  </div>
                </div>
                <div className="cos-detail-act">
                  <span className="label">{acquisitionText(selected)}</span>
                  {isOwned ? (
                    <button className="btn outline nav" disabled={isFitted} onClick={equip}>
                      {isFitted ? 'FITTED' : 'FIT TO SHIP'}
                    </button>
                  ) : (
                    <button
                      className="btn outline nav"
                      onClick={() => {
                        sfx('click');
                        onShop();
                      }}
                    >
                      {selected.obtain.kind === 'shop' || selected.obtain.kind === 'case' ? 'GO TO SHOP' : 'LOCKED'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="back-row">
          <button className="btn outline nav" onClick={back}>
            BACK
          </button>
        </div>
      </div>
    </div>
  );
}
