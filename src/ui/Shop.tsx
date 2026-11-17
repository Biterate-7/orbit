import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { CASES, DUPLICATE_VALUE, caseProgress, casePool, effectiveOdds } from '../game/cosmetics/cases';
import type { CaseDef, CaseRoll } from '../game/cosmetics/cases';
import { COSMETICS, DEFAULT_LOADOUT, RARITY_COLOR, RARITY_LABEL, RARITY_RANK, SLOT_LABEL, resolveLook } from '../game/cosmetics/catalog';
import type { CosmeticDef } from '../game/cosmetics/catalog';
import type { SaveData } from '../game/persistence';
import type { SfxName } from '../game/types';
import type { Progression } from '../progression/service';
import { useKeys } from './hooks';
import { PixelIcon } from './PixelIcon';
import { CosmeticThumb, ShipPreview } from './ShipPreview';

interface Props {
  save: SaveData;
  progress: Progression;
  onBack: () => void;
  onHangar: () => void;
  sfx: (n: SfxName) => void;
}

type Tab = 'cases' | 'direct';

const REEL_LENGTH = 34;
const REEL_WIN = 29;
const REEL_MS = 3200;
/** How long the opening animation runs before the reward is shown. */
export const CASE_REVEAL_MS = REEL_MS;

/** A strip of items to scroll past before the reward: drawn with the case's own odds, the reward at a fixed slot. */
function buildReel(c: CaseDef, win: CosmeticDef): CosmeticDef[] {
  const pool = casePool(c);
  const odds = effectiveOdds(c);
  const total = odds.reduce((s, o) => s + o.chance, 0);
  const strip: CosmeticDef[] = [];
  for (let i = 0; i < REEL_LENGTH; i++) {
    let r = Math.random() * total;
    let rarity = odds[0].rarity;
    for (const o of odds) {
      r -= o.chance;
      if (r < 0) {
        rarity = o.rarity;
        break;
      }
    }
    const tier = pool.filter((x) => x.rarity === rarity);
    strip.push(tier[Math.floor(Math.random() * tier.length)] ?? win);
  }
  strip[REEL_WIN] = win;
  return strip;
}

interface Opening {
  def: CaseDef;
  roll: CaseRoll;
  reel: CosmeticDef[];
  stage: 'spin' | 'reveal';
  key: number;
}

/**
 * The shop. Everything is bought with credits earned in play; there is no other currency. Each
 * case lists the odds it is actually rolled with and what it can contain.
 */
export function Shop({ save, progress, onBack, onHangar, sfx }: Props) {
  const [tab, setTab] = useState<Tab>('cases');
  const [open, setOpen] = useState<Opening | null>(null);
  const [contents, setContents] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const owned = useMemo(() => new Set(Object.keys(save.inventory.owned)), [save.inventory.owned]);
  const reduced = save.settings.reducedEffects || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  useKeys({ Escape: () => (open ? (open.stage === 'reveal' ? setOpen(null) : undefined) : onBack()) });

  // The reel runs for a fixed time, then gives way to the reveal.
  useEffect(() => {
    if (!open || open.stage !== 'spin') return;
    const t = window.setTimeout(
      () => {
        setOpen((o) => (o ? { ...o, stage: 'reveal' } : o));
        sfx(RARITY_RANK[open.roll.rarity] >= 3 ? 'upgrade' : 'dock');
      },
      reduced ? 250 : REEL_MS,
    );
    return () => window.clearTimeout(t);
  }, [open?.key, open?.stage]); // eslint-disable-line react-hooks/exhaustive-deps

  const openCase = (def: CaseDef): void => {
    const out = progress.dispatch({ type: 'open_case', caseId: def.id, random: Math.random });
    if (!out.ok || !out.roll) {
      setNote(out.reason);
      sfx('warning');
      return;
    }
    setNote('');
    sfx('warp');
    setOpen({ def, roll: out.roll, reel: buildReel(def, out.roll.item), stage: 'spin', key: Date.now() });
  };

  const buy = (c: CosmeticDef): void => {
    const out = progress.dispatch({ type: 'buy_cosmetic', id: c.id });
    setNote(out.ok ? `${c.name} ADDED TO THE HANGAR` : out.reason);
    sfx(out.ok ? 'upgrade' : 'warning');
  };

  const direct = COSMETICS.filter((c) => c.obtain.kind === 'shop').sort((a, b) => (a.obtain.kind === 'shop' && b.obtain.kind === 'shop' ? a.obtain.price - b.obtain.price : 0));

  return (
    <div className="overlay dim">
      <div className="panel shop" role="dialog" aria-label="Shop">
        <div className="x-head">
          <div>
            <h2 className="panel-title">SHOP</h2>
            <p className="panel-sub">PAID FOR WITH CREDITS EARNED IN FLIGHT. THERE IS NO OTHER WAY TO BUY ANYTHING.</p>
          </div>
          <div className="credits">
            <div className="label">CREDITS</div>
            <div className="value">{save.credits} CR</div>
          </div>
        </div>

        <div className="cat-tabs">
          <button className={`cat-tab${tab === 'cases' ? ' on' : ''}`} onClick={() => setTab('cases')}>
            CASES
          </button>
          <button className={`cat-tab${tab === 'direct' ? ' on' : ''}`} onClick={() => setTab('direct')}>
            DIRECT SALE
          </button>
          <span className="shop-note" role="status">
            {note}
          </span>
        </div>

        {tab === 'cases' && (
          <div className="cases">
            {CASES.map((c) => {
              const prog = caseProgress(c, owned);
              const pity = save.shop.pity[c.id] ?? 0;
              const left = Math.max(1, c.pity.after - pity);
              const afford = save.credits >= c.price;
              const pool = casePool(c);
              return (
                <div key={c.id} className="case" style={{ '--rar': c.color } as CSSProperties}>
                  <div className="case-top">
                    <div className="case-icon">
                      <PixelIcon name="case" color={c.color} size={36} />
                    </div>
                    <div>
                      <div className="case-name">{c.name}</div>
                      <div className="case-desc">{c.description}</div>
                    </div>
                  </div>
                  <table className="odds" aria-label={`${c.name} odds`}>
                    <tbody>
                      {effectiveOdds(c).map((o) => (
                        <tr key={o.rarity} style={{ '--rar': RARITY_COLOR[o.rarity] } as CSSProperties}>
                          <th>{RARITY_LABEL[o.rarity]}</th>
                          <td className="bar">
                            <i style={{ width: `${Math.max(2, o.chance)}%` }} />
                          </td>
                          <td className="pct">{o.chance % 1 === 0 ? o.chance : o.chance.toFixed(1)}%</td>
                          <td className="n">{o.items} ITEMS</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="case-rules">
                    <div>
                      GUARANTEED {RARITY_LABEL[c.pity.rarity]} OR BETTER WITHIN {c.pity.after} OPENS · {left === 1 ? 'NEXT OPEN' : `${left} TO GO`}
                    </div>
                    <div>
                      YOU OWN {prog.owned}/{prog.total}. NEW ITEMS COME FIRST; A DUPLICATE IS REFUNDED ({Object.entries(DUPLICATE_VALUE)
                        .filter(([r]) => (c.odds[r as keyof typeof DUPLICATE_VALUE] ?? 0) > 0)
                        .map(([, v]) => v)
                        .join(' / ')}{' '}
                      CR).
                    </div>
                  </div>
                  <div className="case-act">
                    <button className="btn small outline nav" onClick={() => setContents(contents === c.id ? null : c.id)} aria-expanded={contents === c.id}>
                      {contents === c.id ? 'HIDE CONTENTS' : 'VIEW CONTENTS'}
                    </button>
                    <button className="btn outline nav buy" disabled={!afford} onClick={() => openCase(c)}>
                      OPEN <span className="cost">{c.price} CR</span>
                    </button>
                  </div>
                  {contents === c.id && (
                    <div className="case-pool">
                      {pool
                        .sort((a, b) => RARITY_RANK[b.rarity] - RARITY_RANK[a.rarity] || a.name.localeCompare(b.name))
                        .map((i) => (
                          <div key={i.id} className={`pool-item${owned.has(i.id) ? ' have' : ''}`} style={{ '--rar': RARITY_COLOR[i.rarity] } as CSSProperties} title={`${i.name} · ${SLOT_LABEL[i.slot]}`}>
                            <CosmeticThumb item={i} scale={1.5} />
                            <span>{i.name}</span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {tab === 'direct' && (
          <div className="direct">
            {direct.map((c) => {
              const price = c.obtain.kind === 'shop' ? c.obtain.price : 0;
              const has = owned.has(c.id);
              return (
                <div key={c.id} className={`sale${has ? ' have' : ''}`} style={{ '--rar': RARITY_COLOR[c.rarity] } as CSSProperties}>
                  <CosmeticThumb item={c} />
                  <div className="sale-info">
                    <div className="sale-name">{c.name}</div>
                    <div className="label">
                      {RARITY_LABEL[c.rarity]} · {SLOT_LABEL[c.slot]}
                    </div>
                    <div className="sale-desc">{c.description}</div>
                  </div>
                  <button className="btn outline nav buy" disabled={has || save.credits < price} onClick={() => buy(c)}>
                    {has ? 'OWNED' : <span className="cost">{price} CR</span>}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="back-row">
          <button
            className="btn outline nav"
            onClick={() => {
              sfx('click');
              onBack();
            }}
          >
            BACK
          </button>
          <button
            className="btn outline nav"
            onClick={() => {
              sfx('click');
              onHangar();
            }}
          >
            HANGAR
          </button>
        </div>
      </div>

      {open && (
        <div className="opening" role="dialog" aria-label="Opening a case" style={{ '--rar': RARITY_COLOR[open.roll.rarity] } as CSSProperties}>
          {open.stage === 'spin' ? (
            <div className="reel-wrap" key={open.key}>
              <div className="label">{open.def.name}</div>
              <div className="reel">
                <div className="reel-mark" />
                <div className={`reel-strip${reduced ? ' still' : ''}`} style={{ '--stop': REEL_WIN } as CSSProperties}>
                  {open.reel.map((i, n) => (
                    <div key={n} className="reel-cell" style={{ '--rar': RARITY_COLOR[i.rarity] } as CSSProperties}>
                      <CosmeticThumb item={i} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className={`reveal rarity-${open.roll.rarity}`}>
              <div className="reveal-rays" aria-hidden="true" />
              <div className="rar-badge big">{RARITY_LABEL[open.roll.rarity]}</div>
              <div className="reveal-stage">
                <ShipPreview look={resolveLook({ ...DEFAULT_LOADOUT, ...save.inventory.equipped, [open.roll.item.slot]: open.roll.item.id })} width={96} height={56} scale={4.5} reduced={save.settings.reducedEffects} />
              </div>
              <div className="reveal-name">{open.roll.item.name}</div>
              <div className="label">{SLOT_LABEL[open.roll.item.slot]}</div>
              <p className="reveal-desc">{open.roll.item.description}</p>
              {open.roll.duplicate ? (
                <div className="reveal-dup">ALREADY OWNED · CONVERTED TO +{open.roll.refund} CR</div>
              ) : (
                <div className="reveal-new">NEW · ADDED TO THE HANGAR{open.roll.guaranteed ? ' · GUARANTEED DROP' : ''}</div>
              )}
              <div className="reveal-act">
                {!open.roll.duplicate && (
                  <button
                    className="btn outline nav"
                    onClick={() => {
                      progress.dispatch({ type: 'equip_cosmetic', slot: open.roll.item.slot, id: open.roll.item.id });
                      sfx('upgrade');
                      setOpen(null);
                    }}
                  >
                    FIT NOW
                  </button>
                )}
                <button className="btn outline nav" disabled={save.credits < open.def.price} onClick={() => openCase(open.def)}>
                  OPEN ANOTHER <span className="cost">{open.def.price} CR</span>
                </button>
                <button className="btn primary nav" onClick={() => setOpen(null)}>
                  DONE
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
