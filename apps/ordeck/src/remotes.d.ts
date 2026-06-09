/// <reference types="vite/client" />

/* Type declarations for Module Federation remote widgets.
   Each remote exposes a single default React component. */

declare module 'plex-plugin/Widget' {
  import { ComponentType } from 'react';
  const Widget: ComponentType;
  export default Widget;
}

declare module 'lazuros-plugin/Widget' {
  import { ComponentType } from 'react';
  const Widget: ComponentType;
  export default Widget;
}

declare module 'beigeboard-plugin/Widget' {
  import { ComponentType } from 'react';
  const Widget: ComponentType;
  export default Widget;
}

declare module 'recipe-plugin/Widget' {
  import { ComponentType } from 'react';
  const Widget: ComponentType;
  export default Widget;
}

declare module 'sylibos-plugin/Widget' {
  import { ComponentType } from 'react';
  const Widget: ComponentType;
  export default Widget;
}
