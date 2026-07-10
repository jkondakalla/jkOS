// offline/ — PapyrOS's offline media cache (Wave 7.1). One place the rest of the app
// (and Waves 7.2 write-queue / 7.3 SW media router) import from.
//
// Public surface:
//   Storage identity (also used by public/sw.js in 7.3):
//     MEDIA_CACHE, OFFLINE_DB, OFFLINE_DB_VERSION, BOOKS_STORE
//     streamKey / coverKey / detailKey  — a book's Cache API keys
//     OfflineBookRecord                 — the IndexedDB bookkeeping row
//   Bookkeeping (IndexedDB):
//     offlineSupported, getAllOfflineBooks, getOfflineBook, putOfflineBook, deleteOfflineBook
//   Pipeline + reactive store:
//     downloadBook, cancelDownload, removeDownload, estimateStorage
//     useOfflineStatus(bookId), useOfflineLibrary()
//     OfflineStatus / OfflinePhase / StorageEstimate types
//   Components:
//     OfflineBadge, OfflineButton, OfflineSettings

export {
  MEDIA_CACHE, OFFLINE_DB, OFFLINE_DB_VERSION, BOOKS_STORE,
  streamKey, coverKey, detailKey,
  type OfflineBookRecord,
} from './constants';

export {
  offlineSupported,
  getAllOfflineBooks, getOfflineBook, putOfflineBook, deleteOfflineBook,
} from './db';

export {
  downloadBook, cancelDownload, removeDownload, estimateStorage,
  useOfflineStatus, useOfflineLibrary,
  type OfflineStatus, type OfflinePhase, type StorageEstimate,
} from './store';

export { default as OfflineBadge } from './OfflineBadge';
export { default as OfflineButton } from './OfflineButton';
export { default as OfflineSettings } from './OfflineSettings';
