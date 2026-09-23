// @jkos/scene/math — Layer 0: the pure half of a 3-D view. No DOM, no clock, no
// runtime imports outside this directory, so a Web Worker and a node gate can load
// it. test/scene.test.mjs holds that, and drives every function below.
export * from './motion';
export * from './rig';
export * from './gesture';
export * from './pick';
export * from './texture';
export * from './color';
