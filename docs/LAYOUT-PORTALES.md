# Layout de los portales Admin y Cliente (guía de portado)

Fuentes originales (`frontend/src/portals/`):

| Portal | JSX | CSS |
|---|---|---|
| Admin | `admin/layout/AdminLayout, AdminHeader, AdminSidebar` | `adminLayout.css` + `AdminMobileNav.css` |
| Cliente | `client/layout/ClientLayout, ClientHeader, ClientSidebar, ClientBottomNav` | `clientLayout.css` (+ `consentLock.css`) |

Stack: React 19, react-router-dom 7 (`NavLink`), react-icons (`fa`, `hi2`, `md`), fuente Inter (Google Fonts). Sin librería de UI: todo es CSS plano con BEM (`bloque__elemento`).

> Código muerto que NO hay que portar: `components/Navbar.jsx` (sidebar viejo con toggle y color `#33576f`), `.admin-sidebar.collapsed`, `.admin-sidebar__toggle`, y los `clientLayout - Turquesa*.css` (variantes de color antiguas). El admin tiene muchos `!important` por parches acumulados; abajo va la versión consolidada.

---

## 1. Design tokens (idénticos en ambos portales salvo medidas)

| Token | Valor | Uso |
|---|---|---|
| Primario | `rgb(79 70 229)` (indigo) | activos, botones, avatar |
| Primario hover | `#4338ca` | hover |
| Primario oscuro texto | `#312e81` | textos sobre fondos suaves |
| Primario soft | `rgba(79,70,229,.10)` (admin) / `#f5f3ff` (cliente) | hover de ítems |
| Primario 100 / 200 / borde | `#e0e7ff` / `#c7d2fe` / `#a5b4fc` | ítem activo cliente, chips, bordes |
| Fondo app | `#fafaf9` | body del portal |
| Superficie glass | `rgba(255,255,255,.95)` + `backdrop-filter: blur(10px)` | header, sidebar, cards, menús |
| Texto | `#1c1917` · secundario `#44403c` · muted `#78716c` · muted claro `#a8a29e` | |
| Bordes | `#e7e5e4` · suave `#f5f5f4` | |
| Éxito / Error / Warning / Pending | `#10b981` / `#dc2626` / `#d97706` / `#7c3aed` (fondos `#f0fdf4`, `#fef2f2`, `#fffbeb`, `#f5f3ff`) | |
| Radios | 10px (botones, ítems, inputs de menú), 12px (menús admin), 16px (cards cliente/menús cliente), 24px (modales) | |
| Sombras | xs `0 1px 3px rgba(0,0,0,.06)` · sm `0 4px 6px -1px rgba(0,0,0,.07)` · base `0 10px 15px -3px rgba(0,0,0,.07)` · lg `0 20px 25px -5px rgba(0,0,0,.08)` · primaria `0 4px 14px rgba(79,70,229,.20)` | |
| Tipografía | `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`, `-webkit-font-smoothing: antialiased` | |

Medidas de layout:

| | Admin | Cliente |
|---|---|---|
| Alto header | **58px** | **64px** |
| Sidebar colapsada | **72px** | **76px** |
| Sidebar expandida (hover) | **220px** | **240px** |
| Breakpoint móvil | **≤ 900px** (hamburguesa) | **≤ 768px** (bottom nav) |
| Ancho contenido | main a todo el ancho, padding lateral 2rem | `.client-page` centrada, `min(100%,1140px)`, padding `clamp(1.25rem,2.5vw,2.25rem)` |

---

## 2. Estructura (DOM)

```
<div class="{admin|client}-portal-shell">          min-height:100vh, fondo, fuente
  <header class="…-header">                        sticky top:0, z-index 950, glass, borde inferior
  <div class="…-portal-body">
    <aside class="…-sidebar">                      solo desktop
    <main class="…-portal-main">{children}</main>
  </div>
  <nav class="client-bottom-nav">                  solo cliente, solo móvil
  <GlobalPopupMessages portal="ADMIN|CLIENT"/>     (propio de la app, omitir)
</div>
```

### Header (ambos)
- `position: sticky; top:0; z-index:950; display:flex; justify-content:space-between; align-items:center; padding:0 1.4rem (admin) / 1.5rem (cliente)`; glass + `border-bottom:1px solid #e7e5e4` + sombra xs.
- **Izquierda – marca**: logo circular 36×36 (`border-radius:999px; object-fit:cover`) + texto. Click → home del portal. Admin: dos líneas (título 1rem/800 + subtítulo "Panel administrador" 0.72rem/600 color primario-dark). Cliente: una línea (1rem/700, `letter-spacing:-.01em`).
- **Derecha – usuario**: botón con borde, radio 10px, avatar circular 32px con iniciales (fondo primario soft, texto primario, 0.78rem/700) + chevron (`HiChevronDown`, rota 180° abierto).
  - Admin muestra además nombre (0.88rem/700) y email (0.72rem muted) a la derecha del avatar, truncados (`max-width:240px`).
  - Cliente muestra solo avatar + chevron; el nombre/email van dentro del dropdown.
- **Dropdown**: absolute, `right:0`, `top: calc(100% + .5–.65rem)`, ancho 230px (admin) / min 220px (cliente), glass, borde, radio 12px/16px, sombra lg, ítems `Mi perfil` y `Cerrar sesión` (danger, rojo), separados por `border-top`. Cierra con click fuera (`mousedown` en document) y con `Escape`. Cliente anima con `@keyframes sn-dropdown` (opacity 0→1, translateY(-6px) scale(.98) → 0, .15s).
- Iniciales: primera letra de nombre + apellido; si no hay, primera del email; si no, `U`.

### Contenido
- Admin: `.admin-portal-main { flex:1/min-width:0; overflow-x:hidden; padding: 1rem 2rem 0 }` (en móvil 1rem laterales).
- Cliente: `.client-portal-main { width:100%; overflow-x:hidden }` y dentro cada página usa `.client-page` (centrada 1140px).

---

## 3. Comportamiento del menú

### 3.1 Desktop – sidebar colapsada que se expande con hover (ambos portales)
- Siempre colapsada (solo íconos). **No hay botón toggle.** Al `:hover` sobre la sidebar se expande y aparecen las etiquetas; al salir vuelve a colapsar.
- Ítems colapsados: cuadrado 48×44, ícono centrado, `border-radius:10px`. Expandidos: ancho 100%, `justify-content:flex-start`, `padding:0 .85rem`, `gap:.65rem`.
- Etiqueta: siempre en el DOM, oculta con `max-width:0; opacity:0; overflow:hidden; white-space:nowrap`; en hover `max-width:160px; opacity:1`. Transición ~.16–.2s ease (animar `width`, `max-width`, `opacity`, `padding`, `gap`).
- Estados: hover → fondo primario-soft + texto primario; activo → fondo `rgba(79,70,229,.15)` (admin) / `#e0e7ff` (cliente), texto primario, `font-weight:600`.
- Al expandirse recibe sombra `4px 0 20px rgba(0,0,0,.07)`.
- **Diferencia clave**:
  - **Admin**: la sidebar está *en el flujo* (grid de 2 columnas `72px | 1fr`); al hover el grid pasa a `220px | 1fr`, o sea **empuja el contenido** (se usa `:has(.admin-sidebar:hover)` sobre el body). Sidebar `sticky; top:58px; height:calc(100vh - 58px)`.
  - **Cliente**: la sidebar es `position:fixed` bajo el header y el main tiene `padding-left:76px` fijo; al hover **se superpone** al contenido sin moverlo.
- Admin: grupo **Reportes** con submenú (Consulta usuarios / Consulta reservas) que se despliega en hover (`margin-left ≈ 2rem`, ítems 0.82rem); se abre automáticamente si la ruta empieza con `/admin/reportes`. En colapsado el submenú está oculto (`display:none`, `display:grid` en hover).
- Ítems admin: Dashboard, Espacios, Reglas de negocio, Email templates, Operaciones, Usuarios, Consentimientos, Reportes▾ (iconos `FaHome, FaChartBar, FaCog, MdOutlineMarkEmailRead, FaWrench, FaUserAlt, FaClipboardCheck, FaChartBar`). `Dashboard` usa `end` para no quedar activo en todo `/admin/*`.
- Ítems cliente (4): Inicio `/user` (`end`), Mis reservas, Nueva reserva, Perfil (`FaHome, FaCalendarAlt, FaPlusCircle, FaUserAlt`).
- Ítems con `title={label}` para tooltip nativo en modo colapsado.

### 3.2 Móvil – Admin (≤ 900px): sidebar oculta → botón hamburguesa en el header
- `.admin-sidebar { display:none }`, `.admin-portal-body { display:block }`, main a 100%.
- En el header, dentro de `.admin-header__actions` y **antes** del avatar, aparece un botón circular 38×38 (`FaBars` ↔ `FaTimes`, color primario, `aria-expanded`).
- Abre un **panel flotante** (no ocupa pantalla completa): `position:absolute; top:calc(100% + .75rem); right:0; width:min(86vw,320px); max-height:calc(100vh - 84px); overflow-y:auto; padding:.55rem; background:#fff; border-radius:1.1rem; box-shadow:0 24px 60px rgba(15,23,42,.22); z-index:1200`.
- Contiene los mismos 8 ítems en lista vertical (alto 46px, ícono + texto, radio .9rem, activo/hover fondo tinte + color). **Reportes** es acordeón con chevron que rota; se abre solo si la ruta es `/admin/reportes*`.
- Se cierra: al navegar (`useEffect` sobre `location.pathname` y `onClick` en cada link), click fuera, `Escape`.
- En el header móvil se ocultan subtítulo de marca, nombre/email y chevron del usuario → queda logo + título, hamburguesa, avatar. ≤520px: padding 0.75rem, título max 10.5rem con ellipsis, logo y botones 34–36px.

### 3.3 Móvil – Cliente (≤ 768px): bottom navigation de 4 opciones
- La sidebar desaparece (`display:none` por defecto, solo se muestra ≥769px).
- Barra fija inferior: `position:fixed; left/right/bottom:0; display:grid; grid-template-columns:repeat(4,1fr); z-index:1000`, glass, `border-top`, sombra hacia arriba `0 -4px 12px rgba(0,0,0,.06)`, `padding:.4rem .5rem calc(.4rem + env(safe-area-inset-bottom))` (respeta notch iOS).
- Cada ítem: columna (ícono 1rem arriba, etiqueta 0.67rem/600 abajo), `min-height:52px`, radio 10px, color muted; activo → color primario + fondo `#f5f3ff`.
- Etiquetas cortas: Inicio, Reservas, Reservar, Perfil.
- `.client-portal-main { padding-bottom:76px }` para que la barra no tape contenido; los footers sticky de formularios suben a `bottom:62px`.
- El header cliente en móvil: padding 1rem, título max 10rem / .9rem; solo avatar+chevron.

### 3.4 Bloqueo por consentimientos (solo cliente, opcional)
`ClientLayout` consulta consentimientos pendientes; si hay obligatorios sin aceptar, muestra un banner ámbar arriba del contenido y los ítems del menú (sidebar y bottom nav) excepto Perfil se renderizan como `<span aria-disabled>` con clase `--disabled` en vez de `NavLink`. Es lógica de negocio: omitir si no aplica.

---

## 4. CSS consolidado (listo para portar)

Un solo bloque que reproduce ambos portales. Los prefijos `admin-` / `client-` se mantienen; renombrar a gusto.

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');

:root {
  --primary: rgb(79 70 229);
  --primary-dark: #4338ca;
  --primary-deeper: #312e81;
  --primary-soft: rgba(79,70,229,.10);
  --primary-light: #f5f3ff;
  --primary-100: #e0e7ff;
  --primary-border: #a5b4fc;

  --ink: #1c1917;  --ink-2: #44403c;
  --muted: #78716c; --muted-light: #a8a29e;
  --border: #e7e5e4; --border-light: #f5f5f4;
  --bg: #fafaf9;   --surface: #fff;
  --glass: rgba(255,255,255,.95);
  --glass-blur: blur(10px);
  --danger: #dc2626; --danger-bg: #fef2f2;

  --shadow-xs: 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04);
  --shadow-lg: 0 20px 25px -5px rgba(0,0,0,.08), 0 10px 10px -5px rgba(0,0,0,.03);

  --font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;

  /* Admin */
  --admin-header-h: 58px;
  --admin-sidebar-collapsed: 72px;
  --admin-sidebar-expanded: 220px;
  /* Cliente */
  --client-header-h: 64px;
  --client-sidebar-w: 76px;
  --client-sidebar-open: 240px;
}
*, *::before, *::after { box-sizing: border-box; }

/* ───────── SHELL + HEADER (comunes) ───────── */
.admin-portal-shell, .client-portal-shell {
  min-height: 100vh; background: var(--bg); color: var(--ink);
  font-family: var(--font); -webkit-font-smoothing: antialiased;
}
.admin-header, .client-header {
  position: sticky; top: 0; z-index: 950;
  display: flex; align-items: center; justify-content: space-between; gap: 1rem;
  background: var(--glass); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur);
  border-bottom: 1px solid var(--border); box-shadow: var(--shadow-xs);
}
.admin-header  { height: var(--admin-header-h);  padding: 0 1.4rem; }
.client-header { height: var(--client-header-h); padding: 0 1.5rem; }

.admin-header__brand, .client-header__brand { display: flex; align-items: center; gap: .7rem; min-width: 0; cursor: pointer; }
.admin-header__logo, .client-header__logo { width: 36px; height: 36px; border-radius: 999px; object-fit: cover; flex-shrink: 0; }
.admin-header__brand-text { display: flex; flex-direction: column; min-width: 0; line-height: 1.05; }
.admin-header__brand-text strong { font-size: 1rem; font-weight: 800; white-space: nowrap; }
.admin-header__brand-text span   { margin-top: .16rem; font-size: .72rem; font-weight: 600; color: var(--primary-dark); }
.client-header__title { font-size: 1rem; font-weight: 700; letter-spacing: -.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.admin-header__actions, .client-header__actions { display: flex; align-items: center; gap: .65rem; min-width: 0; }
.admin-header__user, .client-header__user { position: relative; }
.admin-header__user-button, .client-header__user-button {
  display: flex; align-items: center; gap: .55rem; padding: .2rem .6rem .2rem .2rem;
  border: 1px solid var(--border); border-radius: 10px; background: var(--surface);
  color: var(--ink); cursor: pointer; box-shadow: var(--shadow-xs);
  transition: border-color .15s, box-shadow .15s;
}
.admin-header__user-button:hover, .client-header__user-button:hover {
  border-color: var(--primary-border); box-shadow: 0 0 0 3px rgba(79,70,229,.08);
}
.admin-header__avatar, .client-header__avatar {
  width: 32px; height: 32px; display: grid; place-items: center; border-radius: 50%;
  background: var(--primary-100); color: var(--primary-dark);
  font-size: .78rem; font-weight: 700; letter-spacing: .04em; flex-shrink: 0;
}
.admin-header__user-text { display: flex; flex-direction: column; align-items: flex-start; line-height: 1.05; max-width: 240px; }
.admin-header__user-text strong, .admin-header__user-text small { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.admin-header__user-text strong { font-size: .88rem; font-weight: 700; }
.admin-header__user-text small  { margin-top: .16rem; font-size: .72rem; color: var(--muted); }
.admin-header__chevron, .client-header__chevron { font-size: .65rem; color: var(--muted); transition: transform .18s; }

.admin-header__menu, .client-header__menu {
  position: absolute; right: 0; top: calc(100% + .6rem); min-width: 220px;
  background: var(--glass); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow-lg);
  overflow: hidden; animation: dropdown .15s ease;
}
@keyframes dropdown { from { opacity: 0; transform: translateY(-6px) scale(.98); } to { opacity: 1; transform: none; } }
.admin-header__menu button, .client-header__menu button {
  width: 100%; display: flex; align-items: center; gap: .65rem; padding: .8rem 1rem;
  border: 0; background: transparent; color: var(--ink-2); font: 500 .875rem var(--font);
  text-align: left; cursor: pointer; transition: background .12s;
}
.admin-header__menu button:hover, .client-header__menu button:hover { background: var(--primary-light); color: var(--primary-dark); }
.admin-header__menu button.danger, .client-header__menu button.danger { color: var(--danger); }
.admin-header__menu button.danger:hover, .client-header__menu button.danger:hover { background: var(--danger-bg); }
.admin-header__menu button + button, .client-header__menu button + button { border-top: 1px solid var(--border-light); }

/* ───────── ITEM DE SIDEBAR (comunes) ───────── */
.admin-sidebar__item, .client-sidebar__item {
  display: flex; align-items: center; justify-content: center; gap: 0;
  width: 48px; min-height: 44px; padding: 0; border: 0; border-radius: 10px;
  background: transparent; color: var(--muted); text-decoration: none;
  font: 500 .875rem var(--font); white-space: nowrap; overflow: hidden; cursor: pointer; outline: none;
  transition: width .18s ease, padding .18s ease, gap .18s ease, background .15s, color .15s;
}
.admin-sidebar:hover .admin-sidebar__item,
.client-sidebar:hover .client-sidebar__item { justify-content: flex-start; width: 100%; padding: 0 .85rem; gap: .65rem; }
.admin-sidebar__item:hover, .client-sidebar__item:hover { background: var(--primary-soft); color: var(--primary); }
.admin-sidebar__item.active  { background: rgba(79,70,229,.15); color: var(--primary); font-weight: 600; }
.client-sidebar__item.active { background: var(--primary-100);  color: var(--primary); font-weight: 600; }
.client-sidebar__item--disabled { opacity: .45; cursor: not-allowed; pointer-events: none; }
.admin-sidebar__icon, .client-sidebar__icon { flex: 0 0 1.2rem; width: 1.2rem; height: 1.2rem; display: inline-flex; align-items: center; justify-content: center; font-size: .95rem; }
.admin-sidebar__label, .client-sidebar__label {
  display: inline-block; max-width: 0; opacity: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  transition: max-width .16s ease, opacity .16s ease;
}
.admin-sidebar:hover .admin-sidebar__label,
.client-sidebar:hover .client-sidebar__label { max-width: 160px; opacity: 1; }

/* ───────── ADMIN: layout ───────── */
.admin-portal-body {
  display: grid; grid-template-columns: var(--admin-sidebar-collapsed) minmax(0, 1fr);
  min-height: calc(100vh - var(--admin-header-h)); transition: grid-template-columns .2s ease;
}
.admin-portal-body:has(.admin-sidebar:hover) { grid-template-columns: var(--admin-sidebar-expanded) minmax(0, 1fr); }
.admin-sidebar {
  position: sticky; top: var(--admin-header-h); z-index: 900;
  height: calc(100vh - var(--admin-header-h)); padding: .95rem .6rem;
  background: var(--glass); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur);
  border-right: 1px solid var(--border); overflow: hidden;
}
.admin-sidebar:hover { box-shadow: 4px 0 20px rgba(0,0,0,.07); }
.admin-sidebar__nav { display: flex; flex-direction: column; align-items: center; gap: .25rem; }
.admin-sidebar__group { width: 100%; display: flex; flex-direction: column; align-items: center; }
.admin-sidebar:hover .admin-sidebar__group { align-items: stretch; }
.admin-sidebar__submenu { display: none; gap: .2rem; margin: .28rem 0 .32rem 2.05rem; }
.admin-sidebar:hover .admin-sidebar__submenu { display: grid; }
.admin-sidebar__submenu-item { display: block; padding: .48rem .65rem; border-radius: 10px; color: var(--muted); text-decoration: none; font-size: .82rem; font-weight: 500; }
.admin-sidebar__submenu-item:hover  { background: var(--primary-soft); color: var(--primary); }
.admin-sidebar__submenu-item.active { background: rgba(79,70,229,.08); color: var(--primary); font-weight: 600; }
.admin-portal-main { min-width: 0; overflow-x: hidden; background: var(--bg); padding: 1rem 2rem 0; }

/* ───────── ADMIN: menú móvil (hamburguesa) ───────── */
.admin-mobile-nav { display: none; position: relative; }
.admin-mobile-nav__button { width: 38px; height: 38px; display: grid; place-items: center; border: 0; border-radius: 999px; background: var(--primary-soft); color: var(--primary); font-size: 1rem; cursor: pointer; }
.admin-mobile-nav__panel {
  position: absolute; top: calc(100% + .75rem); right: 0; z-index: 1200;
  width: min(86vw, 320px); max-height: calc(100vh - 84px); overflow-y: auto; padding: .55rem;
  background: #fff; border: 1px solid rgba(15,23,42,.10); border-radius: 1.1rem; box-shadow: 0 24px 60px rgba(15,23,42,.22);
}
.admin-mobile-nav__item {
  width: 100%; min-height: 46px; display: flex; align-items: center; gap: .7rem; padding: 0 .85rem;
  border: 0; border-radius: .9rem; background: transparent; color: #334155;
  text-decoration: none; font: 700 .9rem var(--font); cursor: pointer;
}
.admin-mobile-nav__item:hover, .admin-mobile-nav__item.active { background: var(--primary-soft); color: var(--primary); }
.admin-mobile-nav__icon { width: 1.15rem; display: inline-flex; justify-content: center; }
.admin-mobile-nav__chevron { margin-left: auto; transition: transform .18s; }
.admin-mobile-nav__chevron.open { transform: rotate(180deg); }
.admin-mobile-nav__submenu { display: grid; gap: .25rem; margin: .25rem 0 .35rem 2rem; }
.admin-mobile-nav__submenu-item { display: block; padding: .62rem .75rem; border-radius: .75rem; color: #475569; text-decoration: none; font-size: .84rem; font-weight: 700; }
.admin-mobile-nav__submenu-item:hover, .admin-mobile-nav__submenu-item.active { background: var(--primary-soft); color: var(--primary); }

@media (max-width: 900px) {
  .admin-mobile-nav { display: block; }
  .admin-sidebar { display: none; }
  .admin-portal-body { display: block; }
  .admin-portal-main { padding: .9rem 1rem 0; }
  .admin-header { padding: 0 .9rem; }
  .admin-header__brand-text span, .admin-header__user-text, .admin-header__chevron { display: none; }
}
@media (max-width: 520px) {
  .admin-header { padding: 0 .75rem; }
  .admin-header__brand { max-width: calc(100vw - 116px); }
  .admin-header__brand-text strong { max-width: 10.5rem; overflow: hidden; text-overflow: ellipsis; }
  .admin-header__logo { width: 34px; height: 34px; }
  .admin-header__actions { gap: .45rem; }
  .admin-mobile-nav__button, .admin-header__avatar { width: 36px; height: 36px; }
  .admin-mobile-nav__panel { right: -.15rem; width: min(92vw, 320px); }
}

/* ───────── CLIENTE: sidebar desktop (fixed, se superpone) ───────── */
.client-sidebar { display: none; }
.client-portal-main { width: 100%; overflow-x: hidden; }
.client-page { width: min(100%, 1140px); margin: 0 auto; padding: clamp(1.25rem, 2.5vw, 2.25rem); }

@media (min-width: 769px) {
  .client-portal-body { min-height: calc(100vh - var(--client-header-h)); }
  .client-portal-main { padding-left: var(--client-sidebar-w); }
  .client-sidebar {
    display: flex; flex-direction: column; position: fixed; z-index: 900;
    top: var(--client-header-h); left: 0; width: var(--client-sidebar-w); height: calc(100vh - var(--client-header-h));
    padding: 1rem 0; overflow: hidden;
    background: var(--glass); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur);
    border-right: 1px solid var(--border); box-shadow: 2px 0 8px rgba(0,0,0,.04);
    transition: width .2s ease;
  }
  .client-sidebar:hover { width: var(--client-sidebar-open); box-shadow: 4px 0 20px rgba(0,0,0,.07); }
  .client-sidebar__nav { display: flex; flex-direction: column; align-items: center; gap: .25rem; width: 100%; padding: 0 .6rem; }
}

/* ───────── CLIENTE: bottom nav móvil ───────── */
.client-bottom-nav {
  display: none; position: fixed; left: 0; right: 0; bottom: 0; z-index: 1000;
  grid-template-columns: repeat(4, 1fr);
  background: var(--glass); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur);
  border-top: 1px solid var(--border); box-shadow: 0 -4px 12px rgba(0,0,0,.06);
  padding: .4rem .5rem calc(.4rem + env(safe-area-inset-bottom));
}
.client-bottom-nav__item {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .2rem;
  min-height: 52px; border-radius: 10px; color: var(--muted); text-decoration: none;
  font-size: .67rem; font-weight: 600; letter-spacing: .01em; transition: color .15s, background .15s;
}
.client-bottom-nav__item.active { color: var(--primary); background: var(--primary-light); }
.client-bottom-nav__item--disabled { opacity: .45; pointer-events: none; }
.client-bottom-nav__icon { font-size: 1rem; line-height: 1; }

@media (max-width: 768px) {
  .client-bottom-nav { display: grid; }
  .client-portal-main { padding-bottom: 76px; }
  .client-header { padding: 0 1rem; }
  .client-header__title { max-width: 10rem; font-size: .9rem; }
}
```

## 5. Esqueleto JSX mínimo

```jsx
// AdminLayout
<div className="admin-portal-shell">
  <AdminHeader user={user} />           {/* brand + [hamburguesa (CSS: solo ≤900)] + avatar/menu */}
  <div className="admin-portal-body">
    <AdminSidebar />                    {/* <aside><nav> NavLink.admin-sidebar__item > .icon + .label */}
    <main className="admin-portal-main">{children}</main>
  </div>
</div>

// ClientLayout
<div className="client-portal-shell">
  <ClientHeader user={user} />
  <div className="client-portal-body">
    <ClientSidebar />                   {/* 4 NavLink, visible solo ≥769 por CSS */}
    <main className="client-portal-main">{children}</main>
  </div>
  <ClientBottomNav />                   {/* 4 NavLink, visible solo ≤768 por CSS */}
</div>
```

Patrones de JS a replicar (todo en los `*Header.jsx`): `useState` para dropdown y panel móvil; un `useEffect` que registra `mousedown` (click fuera) y `keydown Escape` en `document`; otro `useEffect` que cierra el panel móvil cuando cambia `location.pathname`; `NavLink` con `className={({isActive}) => ...}` y `end` en la ruta raíz.

## 6. Inconsistencias del original a evitar al portar
1. Breakpoints distintos entre portales (900 admin / 768 cliente) y, dentro del admin, el grid se activaba en 769 pero la sidebar se ocultaba en 900: unificado a 900 arriba.
2. Admin: el `@media (max-width:768px)` del padding de `.admin-portal-main` estaba anidado dentro de `@media (min-width:769px)` y nunca aplicaba; el padding móvil real venía de `.admin-page` (`styles.css`, 2rem). Aquí queda explícito en `.admin-portal-main`.
3. `.admin-header` y `.admin-card` también existen en `styles.css` (globales, con `h1`); en la app nueva evitar esa colisión de nombres.
4. El botón hamburguesa original usaba fondo `rgba(255,255,255,.14)` (invisible sobre header blanco) y color `rgb(79 70 229)`; aquí se usa `--primary-soft` para que se vea.
5. Sidebar admin colapsada = 72px vs cliente 76px, y expandida 220 vs 240: si quieren un solo diseño, unificar a un par de valores.
