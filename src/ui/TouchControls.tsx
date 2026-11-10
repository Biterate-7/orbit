import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { Engine } from '../game/engine';
import type { VirtualButton } from '../game/input';
import { PixelIcon } from './PixelIcon';

interface Props {
  engine: Engine;
}

/** On-screen controls for touch devices, kept in the bottom corners away from the orbit. */
export function TouchControls({ engine }: Props) {
  const [held, setHeld] = useState<Record<string, boolean>>({});
  const boostRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let last: boolean | null = null;
    return engine.onFrame(() => {
      const ready = engine.hud.boostReady;
      if (ready !== last && boostRef.current) {
        last = ready;
        boostRef.current.classList.toggle('cooling', !ready);
      }
    });
  }, [engine]);

  useEffect(() => {
    return () => {
      (['up', 'down', 'left', 'right', 'boost'] as VirtualButton[]).forEach((b) => engine.input.setVirtual(b, false));
    };
  }, [engine]);

  const bind = (btn: VirtualButton) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      engine.input.setVirtual(btn, true);
      engine.audio.unlock();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Pointer capture is best-effort; input already registered.
      }
      setHeld((h) => ({ ...h, [btn]: true }));
    },
    onPointerUp: (e: ReactPointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      engine.input.setVirtual(btn, false);
      setHeld((h) => ({ ...h, [btn]: false }));
    },
    onPointerCancel: () => {
      engine.input.setVirtual(btn, false);
      setHeld((h) => ({ ...h, [btn]: false }));
    },
    onLostPointerCapture: () => {
      engine.input.setVirtual(btn, false);
      setHeld((h) => ({ ...h, [btn]: false }));
    },
    onContextMenu: (e: ReactMouseEvent) => e.preventDefault(),
  });

  return (
    <div className="touchpad">
      <div className="touch-group">
        <button className={`tbtn${held.down ? ' held' : ''}`} {...bind('down')} aria-label="Decelerate">
          <PixelIcon name="down" color={held.down ? '#3ef2ff' : '#8592bb'} size={27} />
          BRAKE
        </button>
        <button className={`tbtn${held.up ? ' held' : ''}`} {...bind('up')} aria-label="Accelerate">
          <PixelIcon name="up" color={held.up ? '#ffc94d' : '#8592bb'} size={27} />
          ACCEL
        </button>
      </div>
      <div className="touch-group">
        <button ref={boostRef} className={`tbtn boost${held.boost ? ' held' : ''}`} {...bind('boost')} aria-label="Boost">
          <PixelIcon name="boost" color={held.boost ? '#3ef2ff' : '#9b5cff'} size={27} />
          BOOST
        </button>
      </div>
    </div>
  );
}
