/**
 * The review instrument for the sweep's output.
 *
 * ~110 PNGs with names like `seeded-dark-narrow-chats-selected.png` are a
 * directory nobody reads: the variants of one screen sort alphabetically into
 * four different places, so comparing light against dark means hunting. This
 * writes one page that groups them by *screen*, with every variant of that
 * screen side by side — which is the comparison the sweep exists to support.
 *
 * Self-contained HTML with inlined CSS and no scripts, opened straight off
 * disk with `open screens/index.html`. No build step, no server, nothing to
 * install; the images are referenced by relative filename because the page
 * lives in the same directory as they do.
 */

export interface Shot {
  profile: string
  theme: string
  size: string
  screen: string
  file: string
}

/** Order variants read in: by profile, then theme, then size. */
function variantOrder(shot: Shot): string {
  return `${shot.profile}-${shot.theme}-${shot.size}`
}

/**
 * Groups shots by screen, preserving the order the sweep took them in.
 *
 * Insertion-ordered rather than sorted alphabetically, so the page reads in
 * the order the app itself is laid out — Home, then each section, then the
 * surfaces that are not sections — rather than putting `command-palette`
 * first because of its initial letter.
 */
export function groupByScreen(shots: Shot[]): { screen: string; shots: Shot[] }[] {
  const groups = new Map<string, Shot[]>()
  for (const shot of shots) {
    const existing = groups.get(shot.screen)
    if (existing) existing.push(shot)
    else groups.set(shot.screen, [shot])
  }
  return [...groups].map(([screen, list]) => ({
    screen,
    shots: [...list].sort((a, b) => variantOrder(a).localeCompare(variantOrder(b)))
  }))
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"]/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] as string
  )
}

export function contactSheet(shots: Shot[], takenAt: Date): string {
  const groups = groupByScreen(shots)
  const profiles = [...new Set(shots.map((shot) => shot.profile))]

  const nav = groups
    .map(
      ({ screen, shots: list }) =>
        `<a href="#${escapeHtml(screen)}">${escapeHtml(screen)} <span>${list.length}</span></a>`
    )
    .join('\n')

  const sections = groups
    .map(({ screen, shots: list }) => {
      const cards = list
        .map(
          (shot) => `
        <figure class="shot ${escapeHtml(shot.theme)}">
          <a href="${escapeHtml(shot.file)}" target="_blank" rel="noreferrer">
            <img src="${escapeHtml(shot.file)}" alt="${escapeHtml(shot.file)}" loading="lazy" />
          </a>
          <figcaption>
            <b>${escapeHtml(shot.profile)}</b> · ${escapeHtml(shot.theme)} ·
            ${escapeHtml(shot.size)}
          </figcaption>
        </figure>`
        )
        .join('')
      return `<section id="${escapeHtml(screen)}">
        <h2>${escapeHtml(screen)}</h2>
        <div class="grid">${cards}</div>
      </section>`
    })
    .join('\n')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Switchboard screens — ${takenAt.toISOString().slice(0, 16).replace('T', ' ')}</title>
<style>
  :root { color-scheme: dark; --bg:#0f1115; --panel:#171a21; --line:#272c36; --fg:#e6e8ec; --dim:#9aa3b2; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg);
         font:14px/1.5 ui-sans-serif,-apple-system,"Segoe UI",sans-serif; }
  header { position:sticky; top:0; z-index:2; background:var(--bg);
           border-bottom:1px solid var(--line); padding:14px 20px; }
  header h1 { margin:0 0 2px; font-size:15px; }
  header p { margin:0; color:var(--dim); font-size:12px; }
  nav { display:flex; flex-wrap:wrap; gap:6px; padding:12px 20px;
        border-bottom:1px solid var(--line); }
  nav a { color:var(--dim); text-decoration:none; font-size:12px;
          border:1px solid var(--line); border-radius:99px; padding:3px 10px; }
  nav a:hover { color:var(--fg); border-color:var(--fg); }
  nav a span { opacity:.5; }
  section { padding:22px 20px; border-bottom:1px solid var(--line); }
  section h2 { margin:0 0 12px; font-size:13px; letter-spacing:.08em;
               text-transform:uppercase; color:var(--dim); }
  .grid { display:grid; gap:14px;
          grid-template-columns:repeat(auto-fill,minmax(380px,1fr)); }
  .shot { margin:0; background:var(--panel); border:1px solid var(--line);
          border-radius:8px; overflow:hidden; }
  .shot img { display:block; width:100%; height:auto; background:#000; }
  figcaption { padding:7px 10px; font-size:11px; color:var(--dim);
               border-top:1px solid var(--line); }
  figcaption b { color:var(--fg); font-weight:600; }
</style>
</head>
<body>
<header>
  <h1>Switchboard screens</h1>
  <p>${shots.length} shots · ${groups.length} screens · ${profiles.join(', ')} ·
     ${escapeHtml(takenAt.toLocaleString())}</p>
</header>
<nav>${nav}</nav>
${sections}
</body>
</html>
`
}
