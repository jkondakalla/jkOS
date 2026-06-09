/* Shared types for the ORDECK monorepo.
   All apps and widgets import from @jkos/types. */

export interface WidgetManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  icon?: string;
  color?: string;
  remoteUrl: string;
  port: number;
  launch?: {
    type: 'iframe' | 'tab' | 'embedded';
    target?: string;
  };
}

export interface WidgetStatus {
  online: boolean;
  label?: string;
  detail?: string;
  lastChecked?: string;
}

export interface WidgetOverrides {
  header?: 'classic' | 'band' | 'tab' | 'chip' | 'strip';
  color?: string;
  title?: string;
  textScale?: number;
  radius?: number;
  borderStyle?: 'solid' | 'dashed' | 'dotted' | 'double' | 'none';
  opacity?: number;
}

export interface WidgetInstance {
  id: number;
  type: WidgetType;
  x: number;
  y: number;
  w: number;
  h: number;
  overrides?: WidgetOverrides;
}

export type WidgetType =
  | 'apps'
  | 'clock'
  | 'plugins'
  | 'connections'
  | 'log'
  | 'scope'
  | 'memmap'
  | 'stopwatch'
  | 'worldclocks'
  | 'calc'
  | 'pomodoro'
  | 'calendar'
  | 'reel'
  | 'nixie'
  | 'status'
  | 'grille'
  | 'label'
  | 'ticker'
  | 'datarain'
  | 'gauges'
  | 'blank'
  | 'plex'
  | 'lazuros'
  | 'beigeboard'
  | 'recipe'
  | 'sylibos';

export interface HubUser {
  name: string;
  sessionId: string;
}

export interface WidgetProps {
  widgetId: number;
}

export interface Item {
  id: number;
  kind: 'task' | 'goal' | 'event';
  scope: 'year' | 'month' | 'week' | 'day' | 'subtask';
  title: string;
  notes?: string;
  parent_id?: number;
  accent?: string;
  source: 'bb' | 'google' | 'outlook' | 'icloud';
  completed: boolean;
  year?: string;
  month?: string;
  week_start?: string;
  due_date?: string;
  scheduled_time?: string;
  scheduled_end?: string;
  end_date?: string;
  location?: string;
  attendees?: number;
  target?: string;
  created_at?: string;
}

export interface CalendarAccount {
  id: 'google' | 'outlook' | 'icloud' | 'bb';
  connected: boolean;
  email: string;
  visible: boolean;
  kind: string;
}
