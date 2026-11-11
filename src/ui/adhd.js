// Compatibility shim: the ADHD arcade is Preact + TS now (src/ui/adhd/); gameView still imports './adhd.js'.
export { mountAdhd, disposeAdhd, adhdButton, updateAdhd, celebrate } from './adhd/index';
