/**
 * mush 看板内联 SVG 资产库 (Ponytail Modularization)
 */

export function getDogIcons(): Record<string, string> {
  return {
    whale: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12c3-4 8-6 13-3 2 1 3 3 5 3-1 2-3 3-5 3-4 0-7-2-9-1-2 1-3 0-4-2z"/></svg>`,
    sun: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`,
    spark: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z"/></svg>`,
    swords: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l2 2M16 16l4 4M19 13l2 2M6 3l15 15v3h-3L3 6"/></svg>`,
    pipeline: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="5" height="10" rx="1"/><rect x="10" y="7" width="5" height="10" rx="1"/><rect x="18" y="7" width="5" height="10" rx="1"/><path d="M7 12h3M15 12h3"/></svg>`,
    shield: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    bounty: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 6v12M15 9.5a3.5 3.5 0 0 0-5 0c0 2 5 2 5 4.5a3.5 3.5 0 0 1-6 .5"/></svg>`,
  };
}
