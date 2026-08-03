import { useEffect, useState } from 'react';

/**
 * Height in CSS pixels currently hidden behind the on-screen keyboard.
 *
 * iOS does not reflow the layout viewport when the keyboard opens — it slides
 * a panel over the page. `window.innerHeight` is unchanged, so anything pinned
 * to `bottom: 0` (the chat composer, for one) ends up underneath the keyboard
 * with no way to see what you are typing. `visualViewport` is the only API
 * that reports the covered strip; subtracting it gives the offset the pinned
 * element needs to lift by.
 *
 * Returns 0 where `visualViewport` is unavailable, and on desktop, where the
 * layout and visual viewports agree and this is a no-op.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      // offsetTop is non-zero when the page itself has been scrolled up to
      // reveal a focused field; both parts are hidden from the pinned element.
      const hidden = window.innerHeight - vv.height - vv.offsetTop;
      // Small negative values show up mid-animation and during rubber-banding.
      setInset(hidden > 0 ? Math.round(hidden) : 0);
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return inset;
}
