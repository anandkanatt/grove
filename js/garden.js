'use strict';
// GroveGarden — all art, generated as inline SVG strings. No DOM reads.
const GroveGarden = {};

// Darken/lighten a #rrggbb color by factor (-1..1).
GroveGarden.shade = function (hex, factor) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift) => {
    let c = (n >> shift) & 0xff;
    c = factor < 0 ? Math.round(c * (1 + factor)) : Math.round(c + (255 - c) * factor);
    return Math.max(0, Math.min(255, c));
  };
  return '#' + [16, 8, 0].map(s => ch(s).toString(16).padStart(2, '0')).join('');
};

function petalRing(cx, cy, count, rx, ry, dist, fill, opacity) {
  let out = '';
  for (let i = 0; i < count; i++) {
    const a = (360 / count) * i;
    out += `<ellipse cx="${cx}" cy="${cy - dist}" rx="${rx}" ry="${ry}" fill="${fill}" opacity="${opacity || 1}"
      transform="rotate(${a} ${cx} ${cy})"/>`;
  }
  return out;
}

function leaves(cx, topY, h, color) {
  const y1 = topY + h * 0.55, y2 = topY + h * 0.35;
  return `
    <path d="M ${cx} ${y1} q -14 -4 -16 -14 q 14 -2 16 10 z" fill="${color}"/>
    <path d="M ${cx} ${y2} q 14 -4 16 -14 q -14 -2 -16 10 z" fill="${GroveGarden.shade(color, -0.12)}"/>`;
}

const GROUND = (w) => `
  <ellipse cx="${w / 2}" cy="118" rx="${w * 0.32}" ry="9" fill="#c9a876" opacity="0.85"/>
  <ellipse cx="${w / 2}" cy="116" rx="${w * 0.26}" ry="6" fill="#b08e5e" opacity="0.6"/>`;

// A goal plant. stage 0..4, color = domain color.
GroveGarden.plantSvg = function (stage, color) {
  const stem = '#6f9455';
  const dark = GroveGarden.shade(color, -0.35);
  let body = '';
  if (stage === 0) {
    body = `
      <ellipse cx="50" cy="112" rx="7" ry="9" fill="#8a6238"/>
      <path d="M 50 104 q 3 4 0 8" stroke="#f3e9d2" stroke-width="1.6" fill="none" stroke-linecap="round"/>
      <circle cx="61" cy="97" r="1.6" fill="#d9a441" opacity="0.8"/>`;
  } else if (stage === 1) {
    body = `
      <path d="M 50 116 q -1 -12 0 -20" stroke="${stem}" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M 50 100 q -10 -2 -12 -10 q 10 -1 12 7 z" fill="${stem}"/>
      <path d="M 50 104 q 10 -3 12 -11 q -10 -1 -12 8 z" fill="${GroveGarden.shade(stem, -0.12)}"/>`;
  } else if (stage === 2) {
    body = `
      <path d="M 50 116 q -2 -22 0 -42" stroke="${stem}" stroke-width="3.4" fill="none" stroke-linecap="round"/>
      ${leaves(50, 74, 42, stem)}
      <ellipse cx="50" cy="68" rx="7" ry="10" fill="${color}" opacity="0.95"/>
      <path d="M 44 68 q 6 -12 12 0 q -6 6 -12 0 z" fill="${GroveGarden.shade(color, 0.18)}"/>
      <path d="M 47 76 q 3 3 6 0" stroke="${stem}" stroke-width="2" fill="none"/>`;
  } else if (stage === 3) {
    body = `
      <path d="M 50 116 q -2 -28 0 -54" stroke="${stem}" stroke-width="3.6" fill="none" stroke-linecap="round"/>
      ${leaves(50, 66, 50, stem)}
      ${petalRing(50, 48, 8, 7, 13, 12, color)}
      <circle cx="50" cy="48" r="8.5" fill="${dark}"/>
      <circle cx="47.5" cy="45.5" r="2.6" fill="${GroveGarden.shade(color, 0.5)}" opacity="0.9"/>`;
  } else {
    body = `
      <circle cx="50" cy="44" r="30" fill="${color}" opacity="0.14"/>
      <path d="M 50 116 q -2 -30 0 -58" stroke="${stem}" stroke-width="4" fill="none" stroke-linecap="round"/>
      ${leaves(50, 62, 54, stem)}
      ${petalRing(50, 44, 10, 8, 16, 15, GroveGarden.shade(color, -0.15), 0.9)}
      ${petalRing(50, 44, 8, 7, 13, 11, GroveGarden.shade(color, 0.12))}
      <circle cx="50" cy="44" r="9" fill="${dark}"/>
      <circle cx="47" cy="41" r="2.8" fill="${GroveGarden.shade(color, 0.55)}"/>
      <circle cx="24" cy="34" r="1.8" fill="#d9a441"/>
      <circle cx="78" cy="52" r="1.4" fill="#d9a441"/>
      <circle cx="68" cy="22" r="1.6" fill="#e8c76c"/>`;
  }
  return `<svg viewBox="0 0 100 130" xmlns="http://www.w3.org/2000/svg" role="img">${GROUND(100)}${body}</svg>`;
};

// Flower-face avatar for players and members.
GroveGarden.avatarSvg = function (palette) {
  const { petal, center } = palette;
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" role="img">
    ${petalRing(32, 32, 9, 7, 12, 14, petal)}
    ${petalRing(32, 32, 9, 6, 10, 11, GroveGarden.shade(petal, 0.22))}
    <circle cx="32" cy="32" r="12" fill="${center}"/>
    <circle cx="27.5" cy="30" r="1.8" fill="#fff8ec"/>
    <circle cx="36.5" cy="30" r="1.8" fill="#fff8ec"/>
    <path d="M 27 36 q 5 4.5 10 0" stroke="#fff8ec" stroke-width="1.8" fill="none" stroke-linecap="round"/>
  </svg>`;
};

GroveGarden.decorSvg = function (kind) {
  const art = {
    butterfly: `
      <path d="M 30 30 q -16 -14 -20 -2 q -2 10 16 8 z" fill="#e8927c"/>
      <path d="M 34 30 q 16 -14 20 -2 q 2 10 -16 8 z" fill="#e77f9d"/>
      <path d="M 30 34 q -12 12 -16 4 q -1 -8 14 -8 z" fill="#f0b660"/>
      <path d="M 34 34 q 12 12 16 4 q 1 -8 -14 -8 z" fill="#f2a2c0"/>
      <rect x="30.4" y="24" width="3.2" height="18" rx="1.6" fill="#5b4a3a"/>
      <path d="M 31 24 q -4 -6 -7 -7 M 33 24 q 4 -6 7 -7" stroke="#5b4a3a" stroke-width="1.4" fill="none" stroke-linecap="round"/>`,
    lantern: `
      <path d="M 32 8 v 6" stroke="#8a6238" stroke-width="2"/>
      <rect x="22" y="14" width="20" height="30" rx="7" fill="#f0c04a" stroke="#b08030" stroke-width="2"/>
      <circle cx="32" cy="29" r="6" fill="#fff3c9"/>
      <rect x="26" y="44" width="12" height="4" rx="2" fill="#b08030"/>`,
    birdbath: `
      <ellipse cx="32" cy="20" rx="18" ry="6" fill="#cfd8cd"/>
      <ellipse cx="32" cy="19" rx="13" ry="3.6" fill="#9fc7d8"/>
      <path d="M 28 24 h 8 l -2 16 h -4 z" fill="#b8c4b6"/>
      <ellipse cx="32" cy="44" rx="11" ry="4" fill="#b8c4b6"/>
      <circle cx="41" cy="14" r="2.8" fill="#c47b4e"/>
      <path d="M 41 16 q 4 2 2 5" stroke="#c47b4e" stroke-width="1.6" fill="none"/>`,
    windchime: `
      <path d="M 20 12 h 24" stroke="#8a6238" stroke-width="3" stroke-linecap="round"/>
      <line x1="24" y1="14" x2="24" y2="34" stroke="#a8b5a5" stroke-width="2.4"/>
      <line x1="32" y1="14" x2="32" y2="42" stroke="#a8b5a5" stroke-width="2.4"/>
      <line x1="40" y1="14" x2="40" y2="30" stroke="#a8b5a5" stroke-width="2.4"/>
      <circle cx="24" cy="37" r="2.4" fill="#d9a441"/>
      <circle cx="32" cy="45" r="2.4" fill="#d9a441"/>
      <circle cx="40" cy="33" r="2.4" fill="#d9a441"/>`,
    gnome: `
      <path d="M 32 8 q 12 8 8 20 h -16 q -4 -12 8 -20 z" fill="#c66b8e"/>
      <circle cx="32" cy="32" r="7" fill="#f0cfa8"/>
      <path d="M 25 36 q 7 10 14 0 l 2 12 h -18 z" fill="#6aa3a0"/>
      <path d="M 27 34 q 5 8 10 0 q -2 8 -5 8 q -3 0 -5 -8 z" fill="#f3e9d2"/>`,
    bench: `
      <rect x="12" y="26" width="40" height="5" rx="2.5" fill="#a8794f"/>
      <rect x="12" y="18" width="40" height="4" rx="2" fill="#b8895f"/>
      <rect x="15" y="31" width="4" height="14" fill="#8a6238"/>
      <rect x="45" y="31" width="4" height="14" fill="#8a6238"/>
      <rect x="12" y="12" width="40" height="4" rx="2" fill="#b8895f"/>`,
    fairylights: `
      <path d="M 8 20 q 24 16 48 0" stroke="#8a6238" stroke-width="1.8" fill="none"/>
      <circle cx="16" cy="24" r="3" fill="#f0c04a"/><circle cx="26" cy="28" r="3" fill="#e8927c"/>
      <circle cx="38" cy="28" r="3" fill="#a58fd4"/><circle cx="48" cy="24" r="3" fill="#8fbf9f"/>
      <circle cx="16" cy="24" r="5" fill="#f0c04a" opacity="0.25"/><circle cx="38" cy="28" r="5" fill="#a58fd4" opacity="0.25"/>`,
    fountain: `
      <ellipse cx="32" cy="44" rx="18" ry="5" fill="#9fc7d8"/>
      <ellipse cx="32" cy="43" rx="18" ry="5" fill="none" stroke="#7f9fae" stroke-width="1.6"/>
      <path d="M 26 42 h 12 l -2 -10 h -8 z" fill="#cfd8cd"/>
      <ellipse cx="32" cy="31" rx="9" ry="3" fill="#9fc7d8"/>
      <path d="M 32 28 q -6 -10 0 -16 q 6 6 0 16" fill="#bfe0ec"/>
      <circle cx="24" cy="18" r="1.4" fill="#bfe0ec"/><circle cx="40" cy="20" r="1.4" fill="#bfe0ec"/>`,
    arch: `
      <path d="M 14 48 v -22 a 18 18 0 0 1 36 0 v 22" fill="none" stroke="#a8794f" stroke-width="4"/>
      <circle cx="18" cy="24" r="3.4" fill="#c66b8e"/><circle cx="30" cy="12" r="3.4" fill="#e77f9d"/>
      <circle cx="44" cy="20" r="3.4" fill="#c66b8e"/><circle cx="48" cy="34" r="3.4" fill="#e77f9d"/>
      <circle cx="24" cy="16" r="2.2" fill="#7ba05b"/><circle cx="38" cy="13" r="2.2" fill="#7ba05b"/>`,
  };
  return `<svg viewBox="0 0 64 56" xmlns="http://www.w3.org/2000/svg" role="img">${art[kind] || ''}</svg>`;
};

// Shared community garden: fills with flowers as the weekly challenge advances.
GroveGarden.communityGardenSvg = function (fraction) {
  const f = Math.max(0, Math.min(1, fraction));
  const slots = 12;
  const bloomed = Math.round(f * slots);
  const colors = ['#c66b8e', '#d9a441', '#8e7cc3', '#e8927c', '#6aa3a0', '#7ba05b'];
  let flowers = '';
  for (let i = 0; i < slots; i++) {
    const x = 22 + i * 25 + (i % 2) * 4;
    const h = 26 + ((i * 7) % 12);
    const c = colors[i % colors.length];
    if (i < bloomed) {
      flowers += `
        <path d="M ${x} 96 q -1 -${h * 0.7} 0 -${h}" stroke="#6f9455" stroke-width="2.6" fill="none" stroke-linecap="round"/>
        ${petalRing(x, 96 - h, 7, 3.4, 6.2, 6, c)}
        <circle cx="${x}" cy="${96 - h}" r="3.6" fill="${GroveGarden.shade(c, -0.35)}"/>`;
    } else {
      flowers += `
        <path d="M ${x} 96 q -1 -6 0 -10" stroke="#8fae77" stroke-width="2.2" fill="none" stroke-linecap="round"/>
        <path d="M ${x} 88 q -6 -1 -7 -6 q 6 -1 7 6 z" fill="#8fae77" opacity="0.8"/>`;
    }
  }
  const sunY = 34 - f * 14;
  return `<svg viewBox="0 0 320 110" xmlns="http://www.w3.org/2000/svg" role="img">
    <circle cx="284" cy="${sunY}" r="14" fill="#f0c04a" opacity="${0.45 + f * 0.55}"/>
    <circle cx="284" cy="${sunY}" r="22" fill="#f0c04a" opacity="0.18"/>
    <rect x="0" y="94" width="320" height="16" rx="8" fill="#c9a876" opacity="0.7"/>
    ${flowers}
  </svg>`;
};

if (typeof module !== 'undefined' && module.exports) module.exports = GroveGarden;
if (typeof window !== 'undefined') window.GroveGarden = GroveGarden;
