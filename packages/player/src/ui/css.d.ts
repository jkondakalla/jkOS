// css.d.ts — lets this package's own `tsc --noEmit` accept the side-effect css
// import in src/ui/index.ts. Consuming apps never see this file: their programs
// resolve css imports through their own bundler types (papyros: vite/client).
declare module '*.css';
