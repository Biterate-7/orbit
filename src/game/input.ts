export type VirtualButton = 'up' | 'down' | 'left' | 'right' | 'boost';

const GAME_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'Space',
]);

/**
 * Keyboard, mouse and virtual (touch) input. Held state is polled every physics step;
 * one-shot actions (boost, pause) are queued on key-down and consumed by the engine.
 */
export class Input {
  private keys = new Set<string>();
  private virtual: Record<VirtualButton, boolean> = { up: false, down: false, left: false, right: false, boost: false };
  private mouseLeft = false;
  private mouseRight = false;
  private queue = new Set<'boost' | 'pause'>();
  /** When false, keys are tracked but default browser behaviour is left alone (menus, sliders). */
  capture = false;
  private canvas: HTMLElement | null = null;

  attach(canvas: HTMLElement): void {
    this.canvas = canvas;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('mouseup', this.onMouseUp);
    if (this.canvas) {
      this.canvas.removeEventListener('mousedown', this.onMouseDown);
      this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    }
    this.canvas = null;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.capture && GAME_KEYS.has(e.code)) e.preventDefault();
    this.keys.add(e.code);
    if (e.repeat) return;
    if (this.capture && (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight')) this.queue.add('boost');
    if (this.capture && (e.code === 'Escape' || e.code === 'KeyP')) {
      e.preventDefault();
      this.queue.add('pause');
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onBlur = (): void => this.clear();

  private onMouseDown = (e: MouseEvent): void => {
    if (!this.capture) return;
    if (e.button === 0) this.mouseLeft = true;
    if (e.button === 2) this.mouseRight = true;
    if (e.button === 1) {
      e.preventDefault();
      this.queue.add('boost');
    }
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.mouseLeft = false;
    if (e.button === 2) this.mouseRight = false;
  };

  private onContextMenu = (e: Event): void => e.preventDefault();

  setVirtual(btn: VirtualButton, down: boolean): void {
    if (btn === 'boost') {
      if (down && !this.virtual.boost) this.queue.add('boost');
    }
    this.virtual[btn] = down;
  }

  pressPause(): void {
    this.queue.add('pause');
  }

  clear(): void {
    this.keys.clear();
    this.mouseLeft = false;
    this.mouseRight = false;
    this.virtual = { up: false, down: false, left: false, right: false, boost: false };
  }

  flushQueue(): void {
    this.queue.clear();
  }

  get accel(): boolean {
    return this.keys.has('KeyW') || this.keys.has('ArrowUp') || this.virtual.up || this.mouseLeft;
  }

  get brake(): boolean {
    return this.keys.has('KeyS') || this.keys.has('ArrowDown') || this.virtual.down || this.mouseRight;
  }

  /** -1 = strafe left (A), +1 = strafe right (D). */
  get lateral(): number {
    const l = this.keys.has('KeyA') || this.keys.has('ArrowLeft') || this.virtual.left;
    const r = this.keys.has('KeyD') || this.keys.has('ArrowRight') || this.virtual.right;
    return (r ? 1 : 0) - (l ? 1 : 0);
  }

  consume(action: 'boost' | 'pause'): boolean {
    if (this.queue.has(action)) {
      this.queue.delete(action);
      return true;
    }
    return false;
  }
}
