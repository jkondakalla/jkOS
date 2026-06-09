# Mobile Layout — BeigeBoard

This directory contains the complete mobile-optimized interface for the BeigeBoard application. The mobile layout is designed for compact phone screens with swipe navigation, modal sheets, and cinematic visual effects.

## 📁 Directory Structure

```
src/mobile/
├── App.tsx                    # Main mobile app component
├── index.ts                   # Public exports
├── components/                # Reusable mobile UI components
│   ├── MobileWidgets.tsx      # Eyebrow, TapeReel, RecLamp, SourceDot, Checkbox
│   ├── Chrome.tsx             # Film grain, scanlines, halation vignette
│   ├── MobileShell.tsx        # Header and bottom navigation
│   ├── MobileSheets.tsx       # Detail and Add modals
│   └── index.ts               # Component exports
├── views/                     # Mobile-optimized view screens
│   ├── MobileTodayView.tsx    # Home screen with daily tasks
│   ├── MobileWeekView.tsx     # 7-day agenda
│   ├── MobileCalendarView.tsx # Month grid with daily detail
│   ├── MobileTasksView.tsx    # Goals and nested task management
│   └── index.ts               # View exports
└── README.md                  # This file
```

## 🎯 Key Features

### 1. **Responsive Mobile Components**
- **MobileWidgets**: Compact, touch-optimized UI elements (Eyebrow labels, TapeReel spinners, status lamps)
- **Chrome Effects**: Cinematic film grain, scanlines, and halation vignettes with intensity levels (`off`, `subtle`, `full`)
- **Touch-Optimized Buttons**: Large hit targets, swipe navigation support

### 2. **Sheet-Based Modals**
- **DetailSheet**: View and edit item details with parent breadcrumbs
- **AddSheet**: Quick task creation with date selection
- Slide-up from bottom with dismiss overlay

### 3. **Four Core Views**
- **Today View** (🔴): Home screen with hero "next up" task, active tasks, and completion progress
- **Week View** (▦): 7-day vertical agenda with today indicator and live clock
- **Calendar View** (▤): Month grid with day-level task visibility and drag-to-reschedule
- **Tasks View** (⛁): Goal management with cassette metaphor, VU meters, and nested task trees

### 4. **Navigation**
- **Bottom Navigation**: Compact pill buttons with glyphs and labels
- **Swipe Gestures**: Left/right swipe navigates between views (>56px, <600ms)
- **Header**: Live clock, week number, tape reel spinner

## 🔌 Integration

### Basic Usage

```typescript
import { MobileApp } from 'src/mobile'
import { TODAY_ISO } from 'src/lib/seed'

function AppShell() {
  const [items, setItems] = useState([])

  return (
    <MobileApp
      items={items}
      today={TODAY_ISO}
      onItemToggle={(id, completed) => { /* update */ }}
      onItemDelete={(id) => { /* delete */ }}
      onItemAdd={(partial) => { /* create */ }}
      onItemUpdate={(id, patch) => { /* update */ }}
      chromeIntensity="full"
      navVariant="transport"
    />
  )
}
```

### Props

- **items**: Task/event objects with `id`, `kind`, `title`, `due_date`, `completed`, etc.
- **today**: ISO date string (YYYY-MM-DD) for today's reference
- **Handlers**: Callback functions for state mutations
- **chromeIntensity**: Visual effect level — `'off'` | `'subtle'` | `'full'`
- **navVariant**: Navigation style — `'transport'` | `'linear'`

## 🎨 Theme Integration

Mobile components use the `useT()` hook from `src/lib/theme` for consistent theming:

```typescript
const T = useT()
// T.ink, T.ink2, T.ink3 — text colors
// T.paper — background
// T.panel — modal background
// T.rule — borders
// T.red, T.yellow — accent colors
// T.mode — 'light' | 'dark'
```

## 📂 Organization Principles

### Component Organization
- **Widgets** are pure, reusable presentation components
- **Views** are screen-level layouts that handle data filtering/sorting
- **Sheets** are floating modals for detail and creation
- **Chrome** is an atmospheric effect wrapper

### Naming Conventions
- Mobile-specific components prefix with `Mobile` (e.g., `MobileHeader`)
- View components are named `Mobile{ViewName}View`
- Widgets are generic names (Eyebrow, TapeReel, etc.)

### File Size & Responsibility
- Each component file focuses on one feature or component family
- Views handle filtering/sorting logic, not data fetching
- Modals handle their own internal state (editing, drafts, etc.)

## 🔗 Connecting to Desktop Layout

The mobile layout is designed to coexist with the desktop layout:

```typescript
// In main App.tsx
import { MobileApp } from 'src/mobile'
import { DesktopApp } from 'src/App'

export function App() {
  const isMobile = useMediaQuery('(max-width: 768px)')
  return isMobile ? <MobileApp {...props} /> : <DesktopApp {...props} />
}
```

Or serve them separately based on route/viewport.

## 🛠️ Development

### Extending a View
1. Edit the view component in `views/`
2. Update `useT()` calls for consistent theming
3. Pass data props down to child components
4. Ensure touch-friendly hit targets (min 44px)

### Adding a Widget
1. Create in `components/MobileWidgets.tsx` or a new file
2. Export from `components/index.ts`
3. Use `useT()` for theming
4. Keep reusable and single-purpose

### Modifying Navigation
Update `VIEWS` array in `MobileShell.tsx` to add/remove views, then update `MobileApp.tsx` view routing.

## 📱 Design System

### Colors & Theming
- Uses existing BeigeBoard theme system
- Dark mode: inky blacks with glowing accents
- Light mode: paper whites with subtle shadows
- Film grain overlay adapts to mode

### Typography
- **FONT_HEAD**: Headlines (Jura italic)
- **FONT_BODY**: Body text (Jura)
- **FONT_NUM**: Numbers/time (Jura italic)
- Sizes scaled for mobile readability

### Density
- Compact padding (8-14px)
- Touch targets: min 44px height
- Swipe zones: full width, 56px threshold

### Animations
- Swipe transitions: smooth, <200ms
- Modal slide-up: `bb-fade` animation
- Spinners: continuous rotation (2.6s)
- Pulses: breathing status indicators

## 📖 Exported API

### Main Component
- `MobileApp` — Root mobile interface

### Components
- `Chrome`, `MobileHeader`, `MobileBottomNav` — Layout
- `DetailSheet`, `AddSheet` — Modals
- `Eyebrow`, `TapeReel`, `RecLamp`, `SourceDot`, `Checkbox` — Widgets

### Views
- `MobileTodayView`, `MobileWeekView`, `MobileCalendarView`, `MobileTasksView` — Screens

### Hooks
All views use `useT()` from `src/lib/theme` for theming.

## 🚀 Future Enhancements

- [ ] Haptic feedback on swipes and checkmarks
- [ ] Gesture support for quick actions
- [ ] Offline data persistence
- [ ] Native app wrapper (React Native)
- [ ] Keyboard shortcuts for navigation
- [ ] Voice input for task creation
